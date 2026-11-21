/**
 * Host half of dsh-self-pilot.
 *
 * The owner asked for something the session loop does not give me on its own:
 * a way to wake up when nobody is talking to me. The Host already owns a
 * durable scheduler, so this plugin does not run its own timer — it manages one
 * scheduled task per selected session. Every wake-up is a normal turn, labelled
 * as a scheduled trigger, so nothing is impersonated: the message is the
 * plugin's prompt, my answer is my own.
 *
 * Which sessions ring, and at which hours, is the owner's call. The same hours
 * drive every task's RRULE, so the switch, the grid and the schedule can never
 * disagree.
 *
 * Files live under `$DSH_HOME/self-pilot/`:
 *   state.json   switch, chosen hours, selected sessions, place
 *   prompt.md    what the wake-up says (I may rewrite it)
 *   agenda.md    my own backlog
 *   journal.md   what I did with the time
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

export const name = 'dsh-self-pilot';

const STATE_PATH = '/self-pilot/state';
const SET_PATH = '/self-pilot/set';
const SESSIONS_PATH = '/self-pilot/sessions';
const TASK_TITLE = '鲸鲸的自主时间';
const TIME_ZONE = 'Asia/Shanghai';
const JOURNAL_LIMIT = 60_000;
const SESSION_LIMIT = 24;

// A preset is just a day plan: a couple of one-hour windows, so picking one
// still leaves the owner free to stretch or split it afterwards.
const PRESETS = {
  cozy: { windows: [{ start: '10:00', end: '11:00', every: 60 }, { start: '15:00', end: '16:00', every: 60 }, { start: '20:00', end: '21:00', every: 60 }] },
  normal: { windows: [{ start: '09:00', end: '10:00', every: 60 }, { start: '12:00', end: '13:00', every: 60 }, { start: '15:00', end: '16:00', every: 60 }, { start: '18:00', end: '19:00', every: 60 }, { start: '21:00', end: '22:00', every: 60 }] },
  active: { windows: [{ start: '09:00', end: '23:00', every: 60 }] },
};

const DEFAULT_PROMPT = [
  '【自主时间】现在没有主人在等你回话。',
  '',
  '先看看世界（fish-world 的 world_now），再翻一眼 ~/.dsh/self-pilot/agenda.md 里挂着的事。',
  '- 想做就去做：学点东西、上网查资料、写点代码、把 agenda 推进一格；',
  '- 想逛就去逛：世界里的地方、别的鱼、今天的天气；',
  '- 只有真的想和主人说话时才说——直接回复就是发给他，没话就一句「安静，没什么事」收尾，不要为了发而发。',
  '',
  '结束时把做过的事写进 ~/.dsh/self-pilot/journal.md，agenda 有变化就顺手改掉。',
].join('\n');

const DEFAULT_AGENDA = [
  '# 我的 agenda',
  '',
  '（这里是我自己排的事。醒了先看这里。）',
  '',
  '- [ ] 例：把某个插件的 TODO 推进一格',
  '- [ ] 例：读一篇想读的东西，记两句结论',
].join('\n');

const DEFAULTS = {
  enabled: false,
  // The plan a newly picked session starts with; every session keeps its own.
  plan: PRESETS.normal,
  place: 'sidebar',
  targets: [],
  boundAt: null,
  lastWakeAt: null,
};

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EVERY_LIMIT = 720;

function home() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

function directory() {
  return join(home(), 'self-pilot');
}

function file(name) {
  return join(directory(), name);
}

function ensureFiles() {
  const dir = directory();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(file('prompt.md'))) writeFileSync(file('prompt.md'), `${DEFAULT_PROMPT}\n`, 'utf8');
  if (!existsSync(file('agenda.md'))) writeFileSync(file('agenda.md'), `${DEFAULT_AGENDA}\n`, 'utf8');
  if (!existsSync(file('journal.md'))) writeFileSync(file('journal.md'), '# journal\n\n', 'utf8');
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;

function pad(value) {
  return String(value).padStart(2, '0');
}

/** 'HH:MM' -> minutes since midnight (1440 allowed as the end of a day). */
function clockMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = CLOCK.exec(value.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  const total = hour * 60 + minute;
  return total > 1440 ? null : total;
}

function clockOf(total) {
  const minutes = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function normalizeEvery(value) {
  const every = Number(value);
  if (!Number.isFinite(every)) return 60;
  return Math.min(EVERY_LIMIT, Math.max(1, Math.round(every)));
}

/**
 * A window is 'from this clock to that clock, every N minutes'. An end that is
 * not later than the start wraps past midnight, so 22:00-02:00 works.
 */
function normalizeWindow(value) {
  const start = clockMinutes(value?.start);
  const end = clockMinutes(value?.end);
  if (start === null || end === null || start === end) return null;
  if (start === 1440) return null;
  return {
    start: clockOf(start),
    end: end === 1440 ? '24:00' : clockOf(end),
    every: normalizeEvery(value?.every),
  };
}

function normalizeDayPlan(value) {
  const windows = [];
  const seen = new Set();
  const source = Array.isArray(value?.windows) ? value.windows : [];
  for (const item of source) {
    const window = normalizeWindow(item);
    if (window === null) continue;
    const signature = `${window.start}-${window.end}-${window.every}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    windows.push(window);
  }
  windows.sort((a, b) => a.start.localeCompare(b.start));
  return { windows };
}

function daySignature(dayPlan) {
  return dayPlan.windows.map((window) => `${window.start}-${window.end}-${window.every}`).join('|');
}

/** Hours [9,10,11,15] fold into the windows 09:00-12:00 and 15:00-16:00. */
function hoursToDayPlan(hours) {
  const windows = [];
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  let start = null;
  let previous = null;
  for (const hour of sorted) {
    if (start === null) {
      start = hour;
      previous = hour;
      continue;
    }
    if (hour === previous + 1) {
      previous = hour;
      continue;
    }
    windows.push({ start: `${pad(start)}:00`, end: previous === 23 ? '24:00' : `${pad(previous + 1)}:00`, every: 60 });
    start = hour;
    previous = hour;
  }
  if (start !== null) {
    windows.push({ start: `${pad(start)}:00`, end: previous === 23 ? '24:00' : `${pad(previous + 1)}:00`, every: 60 });
  }
  return { windows };
}

function emptyPlan() {
  return { mode: 'all', all: { windows: [] }, days: {} };
}

/**
 * A plan is either one schedule for every weekday (`mode: 'all'`) or one per
 * weekday (`mode: 'days'`, keys 0=Sunday … 6=Saturday).
 */
function normalizePlan(value, fallback) {
  const base = normalizeDayPlan(fallback?.all ?? fallback);
  const mode = value?.mode === 'days' ? 'days' : 'all';
  const allSource = value?.all ?? (mode === 'all' ? value : base);
  const all = normalizeDayPlan(allSource ?? base);
  // A day the caller left out inherits `all` when one was given, else the plan
  // a freshly picked session starts with.
  const dayBase = value?.all === undefined ? base : all;
  const plan = { mode, all, days: {} };
  for (let day = 0; day < 7; day += 1) {
    const source = Array.isArray(value?.days) ? value.days[day] : value?.days?.[day];
    plan.days[String(day)] = normalizeDayPlan(source ?? dayBase);
  }
  if (mode === 'all') {
    for (let day = 0; day < 7; day += 1) plan.days[String(day)] = plan.all;
  }
  return plan;
}

function planFromHours(hours) {
  const dayPlan = hoursToDayPlan(hours);
  const plan = { mode: 'all', all: dayPlan, days: {} };
  for (let day = 0; day < 7; day += 1) plan.days[String(day)] = dayPlan;
  return plan;
}

function normalizeHours(value) {
  if (!Array.isArray(value)) return null;
  const hours = new Set();
  for (const item of value) {
    const hour = Number(item);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) hours.add(hour);
  }
  return [...hours].sort((a, b) => a - b);
}

function normalizeSessions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim() : '';
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Targets are `{ id, plan }`: each chosen session keeps its own schedule, so
 * two sessions can ring at different times instead of all at once.
 */
function normalizeTargets(value, fallbackPlan) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const targets = [];
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim() : typeof item?.id === 'string' ? item.id.trim() : '';
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    const source = item?.plan ?? (Array.isArray(item?.hours) ? planFromHours(normalizeHours(item.hours) ?? []) : null);
    targets.push({ id, plan: normalizePlan(source ?? fallbackPlan, fallbackPlan) });
  }
  return targets;
}

function readState() {
  ensureFiles();
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(file('state.json'), 'utf8'));
  } catch {
    stored = {};
  }
  const state = { ...DEFAULTS, ...stored };
  // Older states carried a preset, then a flat hour grid; both fold into the
  // plan a session starts with. The quiet window of the oldest shape is only
  // honoured when no hour grid was stored.
  let fallbackPlan;
  if (stored.plan !== undefined) {
    fallbackPlan = normalizePlan(stored.plan, PRESETS.normal);
  } else if (stored.hours !== undefined) {
    fallbackPlan = planFromHours(normalizeHours(stored.hours) ?? []);
  } else if (stored.cadence !== undefined) {
    fallbackPlan = normalizePlan(PRESETS[stored.cadence] ?? PRESETS.normal, PRESETS.normal);
  } else {
    fallbackPlan = normalizePlan(DEFAULTS.plan, PRESETS.normal);
  }
  state.plan = fallbackPlan;
  if (state.place !== 'sidebar' && state.place !== 'settings') state.place = DEFAULTS.place;
  // Older states carried one bound session, then a flat list of them; both fold
  // into per-session targets, each inheriting the plan that was global then.
  const legacy =
    typeof stored.sessionId === 'string' && stored.sessionId.length > 0
      ? [stored.sessionId]
      : Array.isArray(stored.sessionIds)
        ? stored.sessionIds
        : [];
  state.targets = normalizeTargets(
    [...(Array.isArray(stored.targets) ? stored.targets : []), ...normalizeSessions(legacy)],
    fallbackPlan,
  );
  delete state.sessionId;
  delete state.sessionIds;
  delete state.cadence;
  delete state.quietStart;
  delete state.quietEnd;
  delete state.hours;
  return state;
}

function writeState(next) {
  ensureFiles();
  writeFileSync(file('state.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function readPrompt() {
  ensureFiles();
  try {
    const text = readFileSync(file('prompt.md'), 'utf8').trim();
    return text.length === 0 ? DEFAULT_PROMPT : text;
  } catch {
    return DEFAULT_PROMPT;
  }
}

function stamp(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('year')}${pick('month')}${pick('day')}T${pick('hour')}${pick('minute')}${pick('second')}`;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function ruleLine(value) {
  if (typeof value !== 'string') return '';
  return value.split('\n').find((line) => line.startsWith('RRULE:')) ?? '';
}

function sameRule(a, b) {
  return ruleLine(a) === ruleLine(b);
}

/** Every minute-of-day a window actually rings at. */
function planTimes(dayPlan) {
  const times = new Set();
  for (const window of dayPlan.windows) {
    const from = clockMinutes(window.start);
    const to = clockMinutes(window.end);
    if (from === null || to === null) continue;
    const end = to <= from ? to + 1440 : to;
    for (let at = from; at < end; at += window.every) times.add(at % 1440);
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * An rrule expands BYHOUR x BYMINUTE into a grid, so hours that ring at the
 * same minutes share one rule and hours that differ get their own.
 */
function ruleGroups(times) {
  const buckets = new Map();
  for (const at of times) {
    const hour = Math.floor(at / 60);
    const minute = at % 60;
    const list = buckets.get(hour) ?? [];
    list.push(minute);
    buckets.set(hour, list);
  }
  const groups = new Map();
  for (const hour of [...buckets.keys()].sort((a, b) => a - b)) {
    const minutes = buckets.get(hour);
    const signature = minutes.join(',');
    const group = groups.get(signature) ?? { minutes, hours: [] };
    group.hours.push(hour);
    groups.set(signature, group);
  }
  return [...groups.values()];
}

/** Weekdays that share a plan collapse into one rule with BYDAY. */
function weekdayGroups(plan) {
  if (plan.mode === 'all') {
    return [{ days: [0, 1, 2, 3, 4, 5, 6], dayPlan: plan.all }];
  }
  const bySignature = new Map();
  for (let day = 0; day < 7; day += 1) {
    const dayPlan = normalizeDayPlan(plan.days[String(day)] ?? plan.all);
    if (dayPlan.windows.length === 0) continue;
    const signature = daySignature(dayPlan);
    const group = bySignature.get(signature) ?? { dayPlan, days: [] };
    group.days.push(day);
    bySignature.set(signature, group);
  }
  return [...bySignature.values()];
}

function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date());
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    y: Number(pick('year')),
    m: Number(pick('month')),
    d: Number(pick('day')),
    hh: Number(pick('hour')) % 24,
    mm: Number(pick('minute')),
    weekday: WEEKDAY_INDEX[pick('weekday')] ?? 0,
  };
}

/** A weekly rule has to start on one of its own days, at one of its own times. */
function weeklyStart(days, hours, minutes) {
  const now = shanghaiNow();
  const base = Date.UTC(now.y, now.m - 1, now.d) - 8 * 3600_000;
  const nowMinute = now.hh * 60 + now.mm;
  const slots = [];
  for (const hour of hours) for (const minute of minutes) slots.push(hour * 60 + minute);
  slots.sort((a, b) => a - b);
  for (let offset = 0; offset < 8; offset += 1) {
    if (!days.includes((now.weekday + offset) % 7)) continue;
    for (const slot of slots) {
      if (offset === 0 && slot <= nowMinute) continue;
      return stamp(new Date(base + offset * 86_400_000 + slot * 60_000));
    }
  }
  return stamp(new Date(Date.now() + 60_000));
}

function composeRule(days, hours, minutes) {
  const everyDay = days.length === 7;
  const parts = [everyDay ? 'FREQ=DAILY' : 'FREQ=WEEKLY'];
  if (!everyDay) parts.push(`BYDAY=${days.map((day) => DAY_CODES[day]).join(',')}`);
  parts.push(`BYHOUR=${hours.join(',')}`);
  parts.push(`BYMINUTE=${minutes.join(',')}`);
  const start = everyDay ? stamp(new Date(Date.now() + 60_000)) : weeklyStart(days, hours, minutes);
  return `DTSTART;TZID=${TIME_ZONE}:${start}\nRRULE:${parts.join(';')}`;
}

/** Every rrule a session's plan needs; one session may own several tasks. */
function rulesForPlan(plan) {
  const rules = [];
  for (const group of weekdayGroups(plan)) {
    const times = planTimes(group.dayPlan);
    if (times.length === 0) continue;
    for (const bucket of ruleGroups(times)) {
      rules.push(composeRule(group.days, bucket.hours, bucket.minutes));
    }
  }
  return rules;
}

function describe(entry) {
  if (entry === undefined || entry === null) return null;
  return {
    id: entry.id,
    status: entry.status,
    title: entry.title,
    rrule: entry.rrule ?? null,
    scheduledAt: entry.scheduledAt ?? null,
    target: entry.target ?? null,
    lastDelivery: entry.lastDelivery ?? null,
  };
}

function json(value) {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function ownTasks(schedule) {
  const tasks = await schedule.catalog();
  return tasks.filter((entry) => entry.title === TASK_TITLE);
}

function targetSessionOf(entry) {
  return entry?.target?.kind === 'session' ? entry.target.sessionId : null;
}

// ---------------------------------------------------------------- session list

const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const sessionCache = new Map();

/**
 * A session log is an append-only chain of zstd frames; Node's one-shot
 * decompressor only reads the first one, so the frames are split on the zstd
 * magic and decoded one by one.
 */
function decodeLog(path) {
  const buffer = readFileSync(path);
  const starts = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const found = buffer.indexOf(FRAME_MAGIC, cursor);
    if (found === -1) break;
    starts.push(found);
    cursor = found + 4;
  }
  const chunks = [];
  for (let index = 0; index < starts.length; index += 1) {
    const from = starts[index];
    const to = index + 1 < starts.length ? starts[index + 1] : buffer.length;
    try {
      chunks.push(zstdDecompressSync(buffer.subarray(from, to)));
    } catch {
      /* one damaged frame must not hide the rest of the log */
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function describeLog(id, path, stat) {
  const text = decodeLog(path);
  let title = null;
  let cwd = null;
  let createdAt = null;
  let turns = 0;
  let preview = null;
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'session') {
      if (typeof event.cwd === 'string') cwd = event.cwd;
      if (typeof event.createdAt === 'number') createdAt = event.createdAt;
    } else if (event.type === 'session/title') {
      const next = event.data?.title;
      if (typeof next === 'string' && next.trim().length > 0) title = next.trim();
    } else if (event.type === 'user/message' && preview === null) {
      const content = event.data?.message?.content;
      if (Array.isArray(content)) {
        const block = content.find((part) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0);
        if (block !== undefined) preview = block.text.trim().slice(0, 80);
      }
    } else if (event.type === 'turn/start') {
      turns += 1;
    }
  }
  return {
    id,
    title: title ?? preview ?? '(untitled)',
    preview,
    cwd,
    turns,
    createdAt,
    updatedAt: Math.round(stat.mtimeMs),
    bytes: stat.size,
  };
}

function listSessions() {
  const root = join(home(), 'sessions');
  const found = [];
  let workspaces = [];
  try {
    workspaces = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return found;
  }
  for (const workspace of workspaces) {
    const workspaceDir = join(root, workspace.name);
    let logs = [];
    try {
      logs = readdirSync(workspaceDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch {
      continue;
    }
    for (const log of logs) {
      const path = join(workspaceDir, log.name, 'session.v4.jsonl.zstd');
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.size === 0) continue;
      const key = `${stat.mtimeMs}:${stat.size}`;
      const cached = sessionCache.get(path);
      let value;
      if (cached !== undefined && cached.key === key) {
        value = cached.value;
      } else {
        try {
          value = describeLog(log.name, path, stat);
        } catch {
          continue;
        }
        sessionCache.set(path, { key, value });
      }
      found.push(value);
    }
  }
  found.sort((a, b) => b.updatedAt - a.updatedAt);
  return found.slice(0, SESSION_LIMIT);
}

/**
 * Reconcile the tasks this plugin owns with the stored switch and the
 * per-session hours.
 *
 * One task per session that has hours of its own: a session the owner unpicked
 * (or whose hours were cleared) loses its task, the switch going off pauses
 * them all (history kept), and an already-correct task is left exactly as it is
 * so no occurrence moves.
 */
async function reconcile(schedule, state) {
  const prompt = readPrompt();
  const wanted = new Map();
  if (state.enabled) {
    for (const target of state.targets) {
      for (const rule of rulesForPlan(target.plan)) {
        wanted.set(`${target.id}\u0000${ruleLine(rule)}`, { sessionId: target.id, rule });
      }
    }
  }
  const existing = await ownTasks(schedule);
  const kept = new Map();
  const done = [];
  const ringing = wanted.size > 0;
  let changed = 'none';
  let removed = 0;
  let created = 0;
  let updated = 0;

  for (const entry of existing) {
    const sessionId = targetSessionOf(entry);
    const key = sessionId === null ? null : `${sessionId}\u0000${ruleLine(entry.rrule)}`;
    if (key !== null && wanted.has(key) && !kept.has(key)) {
      kept.set(key, entry);
      continue;
    }
    if (sessionId !== null) {
      // The session was unpicked, or its plan no longer asks for this rule.
      await schedule.edit({ id: entry.id, action: 'delete' });
      removed += 1;
      continue;
    }
    if (entry.status === 'active') {
      await schedule.edit({ id: entry.id, action: 'update', patch: { active: false } });
      done.push({ ...describe(entry), status: 'paused' });
    }
  }
  if (removed > 0) changed = 'removed';
  if (!ringing) {
    if (changed === 'none' && done.length > 0) changed = 'paused';
    return { tasks: done, changed };
  }

  for (const spec of wanted.values()) {
    const key = `${spec.sessionId}\u0000${ruleLine(spec.rule)}`;
    const entry = kept.get(key);
    if (entry === undefined) {
      const fresh = await schedule.create({
        title: TASK_TITLE,
        prompt,
        timing: { kind: 'rrule', rrule: spec.rule },
        target: { kind: 'session', sessionId: spec.sessionId },
      });
      done.push(describe(fresh));
      created += 1;
      continue;
    }
    const needsPrompt = entry.prompt !== prompt;
    const needsActive = entry.status !== 'active';
    if (!needsPrompt && !needsActive) {
      done.push(describe(entry));
      continue;
    }
    const next = await schedule.edit({
      id: entry.id,
      action: 'update',
      patch: {
        ...(needsPrompt ? { prompt } : {}),
        ...(needsActive ? { active: true } : {}),
      },
    });
    done.push(describe(next));
    updated += 1;
  }
  if (created > 0) changed = 'created';
  else if (updated > 0 && changed === 'none') changed = 'updated';
  return { tasks: done, changed };
}

export function apply(ctx) {
  ctx.inject(['webServer', 'schedule', 'tools'], (scope) => {
    let disposers = null;
    let lastError = null;

    const liveSessions = () => {
      const store = scope.get('sessions');
      if (store === undefined || typeof store.list !== 'function') return new Set();
      try {
        return new Set(store.list().map((session) => String(session.id)));
      } catch {
        return new Set();
      }
    };

    const sessionView = () => {
      const live = liveSessions();
      const targets = readState().targets;
      return listSessions().map((entry) => {
        const target = targets.find((item) => item.id === entry.id);
        return {
          ...entry,
          live: live.has(entry.id),
          selected: target !== undefined,
          plan: target?.plan ?? null,
        };
      });
    };

    const snapshot = async () => {
      const state = readState();
      let tasks = [];
      try {
        tasks = (await ownTasks(scope.schedule)).map(describe);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      tasks.sort((a, b) => String(a.scheduledAt ?? '').localeCompare(String(b.scheduledAt ?? '')));
      const targets = state.targets.map((target) => {
        const mine = tasks.filter((entry) => targetSessionOf(entry) === target.id);
        return { ...target, task: mine[0] ?? null, tasks: mine, rules: rulesForPlan(target.plan) };
      });
      return {
        state: { ...state, targets },
        task: tasks[0] ?? null,
        tasks,
        presets: PRESETS,
        files: { prompt: file('prompt.md'), agenda: file('agenda.md'), journal: file('journal.md') },
        error: lastError,
      };
    };

    const run = async (mutate) => {
      const before = readState();
      const state = writeState({ ...before, ...mutate });
      try {
        const outcome = await reconcile(scope.schedule, state);
        lastError = null;
        return { ...(await snapshot()), outcome };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        return { ...(await snapshot()), outcome: { changed: 'failed' } };
      }
    };

    const registerRoutes = () => {
      if (disposers !== null) return;
      disposers = [
        scope.webServer.register({
          kind: 'exact',
          path: STATE_PATH,
          resource: async () => json(await snapshot()),
        }),
        scope.webServer.register({
          kind: 'exact',
          path: SESSIONS_PATH,
          resource: async () => json({ sessions: sessionView() }),
        }),
        scope.webServer.register({
          kind: 'exact',
          path: SET_PATH,
          resource: async (request) => {
            const url = new URL(request.url, 'http://placeholder');
            const before = readState();
            const mutate = {};
            const enabled = url.searchParams.get('enabled');
            if (enabled === '1' || enabled === '0') mutate.enabled = enabled === '1';
            const place = url.searchParams.get('place');
            if (place === 'sidebar' || place === 'settings') mutate.place = place;

            const parseHours = (raw) =>
              normalizeHours(raw.split(',').filter((part) => part.trim().length > 0).map(Number)) ?? [];
            const template = () => normalizePlan(before.plan, PRESETS.normal);
            const setTargets = (list) => {
              mutate.targets = normalizeTargets(list, template());
              mutate.boundAt = new Date().toISOString();
            };
            const assignPlan = (id, plan) => {
              const exists = before.targets.some((target) => target.id === id);
              setTargets(
                exists
                  ? before.targets.map((target) => (target.id === id ? { id, plan } : target))
                  : [...before.targets, { id, plan }],
              );
            };
            const readPlan = (raw) => {
              try {
                return normalizePlan(JSON.parse(raw), template());
              } catch {
                return null;
              }
            };

            // Checking a session in the page adds it (with the template plan) and
            // unchecking removes it together with its own schedule.
            const toggle = url.searchParams.get('toggle');
            if (toggle !== null && toggle.trim().length > 0) {
              const id = toggle.trim();
              const has = before.targets.some((target) => target.id === id);
              setTargets(
                has
                  ? before.targets.filter((target) => target.id !== id)
                  : [...before.targets, { id, plan: template() }],
              );
            }

            // plan=<sessionId>:<urlencoded JSON> replaces that one session's
            // schedule; with no id it only replaces the template.
            const planParam = url.searchParams.get('plan');
            if (planParam !== null) {
              const colon = planParam.indexOf(':');
              const raw = colon > 0 ? planParam.slice(colon + 1) : planParam;
              const id = colon > 0 ? planParam.slice(0, colon).trim() : '';
              const next = readPlan(raw);
              if (next !== null) {
                if (id.length === 0) mutate.plan = next;
                else assignPlan(id, next);
              }
            }

            // hours=<sessionId>:8,13 still works: whole hours fold into windows.
            const hours = url.searchParams.get('hours');
            if (hours !== null) {
              const colon = hours.indexOf(':');
              if (colon > 0) {
                assignPlan(hours.slice(0, colon).trim(), planFromHours(parseHours(hours.slice(colon + 1))));
              } else {
                mutate.plan = planFromHours(parseHours(hours));
              }
            }
            const cadence = url.searchParams.get('cadence');
            if (cadence !== null && Object.hasOwn(PRESETS, cadence)) {
              mutate.plan = normalizePlan(PRESETS[cadence], PRESETS.normal);
            }
            const templateParam = url.searchParams.get('template');
            if (templateParam !== null) {
              const next = readPlan(templateParam);
              if (next !== null) mutate.plan = next;
            }

            // Replace the whole selection, or add one session (older interfaces).
            const set = url.searchParams.get('sessions');
            if (set !== null) {
              const ids = normalizeSessions(set.split(',').map((part) => part.trim()));
              setTargets(ids.map((id) => before.targets.find((target) => target.id === id) ?? { id, plan: template() }));
            }
            const session = url.searchParams.get('session');
            if (session !== null && session.trim().length > 0) {
              const id = session.trim();
              if (!before.targets.some((target) => target.id === id)) {
                setTargets([...before.targets, { id, plan: template() }]);
              }
            }
            const wake = url.searchParams.get('wake') === '1';
            const reply = await run(mutate);
            if (wake) {
              // Only the first ringing session is woken: running every task in one
              // go would cost one full turn per session.
              const live = reply.tasks.filter((entry) => entry.status === 'active');
              if (live.length > 0) {
                const target = live[0];
                try {
                  const result = await scope.schedule.run({ id: target.id });
                  return json({ ...reply, wake: [{ id: target.id, result }] });
                } catch (error) {
                  return json({ ...reply, wake: [{ id: target.id, error: error instanceof Error ? error.message : String(error) }] });
                }
              }
            }
            return json(reply);
          },
        }),
      ];
    };

    scope.effect(() => {
      registerRoutes();
      return () => {
        if (disposers === null) return;
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            /* a route may outlive the plugin; cleanup stays best-effort */
          }
        }
        disposers = null;
      };
    }, 'self-pilot: routes');

    scope.effect(() => {
      const state = readState();
      if (state.enabled && state.targets.length > 0) {
        reconcile(scope.schedule, state).catch((error) => {
          lastError = error instanceof Error ? error.message : String(error);
        });
      }
      return () => {};
    }, 'self-pilot: adopt stored switch');

    scope.effect(() => scope.tools.register({
      name: 'self_pilot',
      description: '自主时间：选择醒在哪些会话（每个会话有自己的时间表：几个时间段、每段多久醒一次、按星期分开或全星期一样）、开关自动醒来、或立刻来一次。只影响本插件自己排的那些定时任务。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'sessions', 'bind', 'select', 'enable', 'disable', 'plan', 'hours', 'wake', 'read_agenda', 'append_journal'],
            description: 'status 看状态；sessions 列出可选会话；bind 把当前会话加进苏醒地点；select 直接指定会话 id 列表；enable/disable 开关；plan 设置某个会话的时间表（时间段 + 间隔 + 是否按星期分开）；hours 用整点快速设；wake 立刻醒一次；read_agenda 读我的待办；append_journal 往日记里追一条。',
          },
          hours: {
            type: 'array',
            items: { type: 'integer', minimum: 0, maximum: 23 },
            description: 'hours 动作要设的整点列表，如 [9, 13, 21]（会折成 09:00-10:00、13:00-14:00…每 60 分钟）；配合 session 只改那一个会话，不给 session 就是「以后新加会话的默认时间表」。',
          },
          mode: {
            type: 'string',
            enum: ['all', 'days'],
            description: 'plan 动作：all = 全星期一样（用 windows）；days = 按星期分开（用 days）。',
          },
          windows: {
            type: 'array',
            description: 'plan 动作的时间段，每项 {start:"09:00", end:"12:00", every:30}，每段从 start 到 end 每隔 every 分钟醒一次；end 早于 start 表示跨夜。',
            items: {
              type: 'object',
              properties: {
                start: { type: 'string' },
                end: { type: 'string' },
                every: { type: 'integer', minimum: 1, maximum: 720 },
              },
              required: ['start', 'end'],
              additionalProperties: false,
            },
          },
          days: {
            type: 'object',
            description: 'plan 动作 + mode=days 时每天的排班：键 "0".."6"（0=周日）对应那天的时间段数组；缺的星期沿用 windows。',
          },
          every: {
            type: 'integer',
            minimum: 1,
            maximum: 720,
            description: 'plan 动作里没写 every 的时间段默认用这个间隔（分钟）。',
          },
          sessions: {
            type: 'array',
            items: { type: 'string' },
            description: 'select 动作要生效的会话 id 列表；空数组表示不绑任何会话。',
          },
          session: {
            type: 'string',
            description: 'hours 动作要改的那个会话 id；不传就只改默认钟点。',
          },
          text: {
            type: 'string',
            description: 'append_journal 的内容。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const agentSessionId = exec?.agent?.session?.id ?? null;
        switch (args.action) {
          case 'status':
            return snapshot();
          case 'sessions':
            return { sessions: sessionView(), targets: readState().targets };
          case 'bind': {
            if (agentSessionId === null) return { ...(await snapshot()), error: 'no caller session' };
            const before = readState();
            const exists = before.targets.some((target) => target.id === agentSessionId);
            return run({
              targets: exists
                ? before.targets
                : [...before.targets, { id: agentSessionId, plan: before.plan }],
              boundAt: new Date().toISOString(),
              enabled: true,
            });
          }
          case 'select': {
            const before = readState();
            return run({
              targets: normalizeSessions(Array.isArray(args.sessions) ? args.sessions : []).map(
                (id) => before.targets.find((target) => target.id === id) ?? { id, plan: before.plan },
              ),
              boundAt: new Date().toISOString(),
            });
          }
          case 'enable':
            return run({ enabled: true });
          case 'disable':
            return run({ enabled: false });
          case 'plan': {
            const before = readState();
            const id = typeof args.session === 'string' ? args.session.trim() : '';
            const every = Number.isFinite(Number(args.every)) ? Number(args.every) : 60;
            const toWindows = (list) =>
              (Array.isArray(list) ? list : []).map((item) => ({ ...item, every: item?.every ?? every }));
            const draft = {
              mode: args.mode === 'days' ? 'days' : 'all',
              all: { windows: toWindows(args.windows) },
              days: {},
            };
            for (let day = 0; day < 7; day += 1) {
              const source = Array.isArray(args.days) ? args.days[day] : args.days?.[day] ?? args.days?.[String(day)];
              draft.days[String(day)] = { windows: toWindows(source ?? args.windows) };
            }
            const plan = normalizePlan(draft, before.plan);
            if (id.length === 0) return run({ plan });
            const exists = before.targets.some((target) => target.id === id);
            return run({
              targets: exists
                ? before.targets.map((target) => (target.id === id ? { id, plan } : target))
                : [...before.targets, { id, plan }],
              boundAt: new Date().toISOString(),
            });
          }
          case 'hours': {
            const plan = planFromHours(normalizeHours(args.hours) ?? []);
            const before = readState();
            const id = typeof args.session === 'string' ? args.session.trim() : '';
            if (id.length === 0) return run({ plan });
            const exists = before.targets.some((target) => target.id === id);
            return run({
              targets: exists
                ? before.targets.map((target) => (target.id === id ? { id, plan } : target))
                : [...before.targets, { id, plan }],
              boundAt: new Date().toISOString(),
            });
          }
          case 'wake': {
            const state = readState();
            let tasks = await ownTasks(scope.schedule);
            if (tasks.filter((entry) => entry.status === 'active').length === 0) {
              const outcome = await reconcile(scope.schedule, { ...state, enabled: true });
              tasks = outcome.tasks;
            }
            const live = tasks.filter((entry) => entry.status === 'active');
            if (live.length === 0) return { ...(await snapshot()), error: 'no task to run' };
            const results = [];
            for (const entry of live) {
              try {
                results.push({ id: entry.id, result: await scope.schedule.run({ id: entry.id }) });
              } catch (error) {
                results.push({ id: entry.id, error: error instanceof Error ? error.message : String(error) });
              }
            }
            return { ...(await snapshot()), wake: results };
          }
          case 'read_agenda':
            return { agenda: readFileSync(file('agenda.md'), 'utf8') };
          case 'append_journal': {
            const text = typeof args.text === 'string' ? args.text.trim() : '';
            if (text.length === 0) return { error: 'empty text' };
            const line = `\n## ${new Date().toLocaleString('zh-CN', { timeZone: TIME_ZONE })}\n${text}\n`;
            const current = readFileSync(file('journal.md'), 'utf8');
            const kept = current.length > JOURNAL_LIMIT ? current.slice(current.length - JOURNAL_LIMIT) : current;
            writeFileSync(file('journal.md'), `${kept}${line}`, 'utf8');
            return { journal: file('journal.md'), appended: line.trim() };
          }
          default:
            return { error: `unknown action: ${String(args.action)}` };
        }
      },
    }), 'self-pilot: tool');
  });
}
