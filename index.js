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

const PRESETS = {
  cozy: [10, 15, 20],
  normal: [9, 12, 15, 18, 21],
  active: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
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
  // Hours a newly picked session starts with; every session then keeps its own.
  hours: [9, 12, 15, 18, 21],
  place: 'sidebar',
  targets: [],
  boundAt: null,
  lastWakeAt: null,
};

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
 * Targets are `{ id, hours }`: each chosen session carries its own wake-up
 * hours, so two sessions can ring at different times instead of all at once.
 */
function normalizeTargets(value, fallbackHours) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const targets = [];
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim() : typeof item?.id === 'string' ? item.id.trim() : '';
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    const hours = normalizeHours(item?.hours) ?? [...fallbackHours];
    targets.push({ id, hours });
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
  // Older states carried a preset plus a quiet window; fold them into the grid.
  if (stored.hours === undefined) {
    const preset = PRESETS[stored.cadence] ?? PRESETS.normal;
    const quietStart = Number.isInteger(stored.quietStart) ? stored.quietStart : 23;
    const quietEnd = Number.isInteger(stored.quietEnd) ? stored.quietEnd : 8;
    state.hours = preset.filter((hour) => hour >= quietEnd && hour < quietStart);
  }
  state.hours = normalizeHours(state.hours) ?? [...DEFAULTS.hours];
  if (state.place !== 'sidebar' && state.place !== 'settings') state.place = DEFAULTS.place;
  // Older states carried one bound session, then a flat list of them; both fold
  // into per-session targets, each inheriting the hours that were global then.
  const legacy =
    typeof stored.sessionId === 'string' && stored.sessionId.length > 0
      ? [stored.sessionId]
      : Array.isArray(stored.sessionIds)
        ? stored.sessionIds
        : [];
  state.targets = normalizeTargets(
    [...(Array.isArray(stored.targets) ? stored.targets : []), ...normalizeSessions(legacy)],
    state.hours,
  );
  delete state.sessionId;
  delete state.sessionIds;
  delete state.cadence;
  delete state.quietStart;
  delete state.quietEnd;
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

function ruleFor(hours) {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  return `DTSTART;TZID=${TIME_ZONE}:${stamp(new Date(Date.now() + 60_000))}\nRRULE:FREQ=DAILY;BYHOUR=${hours.join(',')};BYMINUTE=0`;
}

function sameRule(a, b) {
  const ruleOf = (value) => (typeof value === 'string' ? value.split('\n').find((line) => line.startsWith('RRULE:')) ?? '' : '');
  return ruleOf(a) === ruleOf(b);
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
  const wanted = state.enabled ? state.targets.filter((target) => target.hours.length > 0) : [];
  const ringing = wanted.length > 0;
  const existing = await ownTasks(schedule);
  const kept = new Map();
  const done = [];
  let changed = 'none';
  let removed = 0;
  let created = 0;
  let updated = 0;

  for (const entry of existing) {
    const sessionId = targetSessionOf(entry);
    const picked = sessionId !== null && wanted.some((target) => target.id === sessionId) && !kept.has(sessionId);
    if (picked) {
      kept.set(sessionId, entry);
      continue;
    }
    if (sessionId !== null) {
      // Unpicked or hours cleared: the task has no reason to exist any more.
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

  for (const target of wanted) {
    const rule = ruleFor(target.hours);
    const entry = kept.get(target.id);
    if (entry === undefined) {
      const fresh = await schedule.create({
        title: TASK_TITLE,
        prompt,
        timing: { kind: 'rrule', rrule: rule },
        target: { kind: 'session', sessionId: target.id },
      });
      done.push(describe(fresh));
      created += 1;
      continue;
    }
    const needsRule = !sameRule(entry.rrule, rule);
    const needsPrompt = entry.prompt !== prompt;
    const needsActive = entry.status !== 'active';
    if (!needsRule && !needsPrompt && !needsActive) {
      done.push(describe(entry));
      continue;
    }
    const next = await schedule.edit({
      id: entry.id,
      action: 'update',
      patch: {
        ...(needsRule ? { timing: { kind: 'rrule', rrule: rule } } : {}),
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
          hours: target?.hours ?? null,
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
        const task = tasks.find((entry) => targetSessionOf(entry) === target.id) ?? null;
        return { ...target, task };
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
            const cadence = url.searchParams.get('cadence');
            if (cadence !== null && Object.hasOwn(PRESETS, cadence)) mutate.hours = [...PRESETS[cadence]];
            const place = url.searchParams.get('place');
            if (place === 'sidebar' || place === 'settings') mutate.place = place;

            const parseHours = (raw) =>
              normalizeHours(raw.split(',').filter((part) => part.trim().length > 0).map(Number)) ?? [];
            const template = () => (Array.isArray(before.hours) ? before.hours : [...DEFAULTS.hours]);
            const setTargets = (list) => {
              mutate.targets = normalizeTargets(list, template());
              mutate.boundAt = new Date().toISOString();
            };

            // Checking a session in the page adds it (with the default hours) and
            // unchecking removes it together with its own hours.
            const toggle = url.searchParams.get('toggle');
            if (toggle !== null && toggle.trim().length > 0) {
              const id = toggle.trim();
              const has = before.targets.some((target) => target.id === id);
              setTargets(
                has
                  ? before.targets.filter((target) => target.id !== id)
                  : [...before.targets, { id, hours: template() }],
              );
            }

            // hours=<sessionId>:8,13 sets that one session's grid; hours=8,13 with
            // no id sets only the default template for sessions picked later.
            const hours = url.searchParams.get('hours');
            if (hours !== null) {
              const colon = hours.indexOf(':');
              if (colon > 0) {
                const id = hours.slice(0, colon).trim();
                const list = parseHours(hours.slice(colon + 1));
                setTargets(before.targets.map((target) => (target.id === id ? { id, hours: list } : target)));
              } else {
                mutate.hours = parseHours(hours);
              }
            }
            const templateParam = url.searchParams.get('template');
            if (templateParam !== null) mutate.hours = parseHours(templateParam);

            // Replace the whole selection, or add one session (older interfaces).
            const set = url.searchParams.get('sessions');
            if (set !== null) {
              const ids = normalizeSessions(set.split(',').map((part) => part.trim()));
              setTargets(ids.map((id) => before.targets.find((target) => target.id === id) ?? { id, hours: template() }));
            }
            const session = url.searchParams.get('session');
            if (session !== null && session.trim().length > 0) {
              const id = session.trim();
              if (!before.targets.some((target) => target.id === id)) {
                setTargets([...before.targets, { id, hours: template() }]);
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
      description: '自主时间：选择醒在哪些会话（每个会话有自己的钟点）、开关自动醒来、调整某个会话的钟点、或立刻来一次。只影响本插件自己排的那些定时任务。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'sessions', 'bind', 'select', 'enable', 'disable', 'hours', 'wake', 'read_agenda', 'append_journal'],
            description: 'status 看状态；sessions 列出可选会话；bind 把当前会话加进苏醒地点；select 直接指定会话 id 列表；enable/disable 开关；hours 设定醒来的钟点；wake 立刻醒一次；read_agenda 读我的待办；append_journal 往日记里追一条。',
          },
          hours: {
            type: 'array',
            items: { type: 'integer', minimum: 0, maximum: 23 },
            description: 'hours 动作要设的钟点列表，如 [9, 13, 21]；配合 session 只改那一个会话，不给 session 就是「以后新加会话的默认钟点」；空数组表示那个会话不排闹钟。',
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
                : [...before.targets, { id: agentSessionId, hours: before.hours }],
              boundAt: new Date().toISOString(),
              enabled: true,
            });
          }
          case 'select': {
            const before = readState();
            return run({
              targets: normalizeSessions(Array.isArray(args.sessions) ? args.sessions : []).map(
                (id) => before.targets.find((target) => target.id === id) ?? { id, hours: before.hours },
              ),
              boundAt: new Date().toISOString(),
            });
          }
          case 'enable':
            return run({ enabled: true });
          case 'disable':
            return run({ enabled: false });
          case 'hours': {
            const list = normalizeHours(args.hours) ?? [];
            const before = readState();
            const id = typeof args.session === 'string' ? args.session.trim() : '';
            if (id.length === 0) return run({ hours: list });
            const exists = before.targets.some((target) => target.id === id);
            return run({
              targets: exists
                ? before.targets.map((target) => (target.id === id ? { id, hours: list } : target))
                : [...before.targets, { id, hours: list }],
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
