/**
 * Host half of dsh-self-pilot.
 *
 * The owner asked for something the session loop does not give me on its own:
 * a way to wake up when nobody is talking to me. The Host already owns a
 * durable scheduler, so this plugin does not run its own timer — it manages one
 * scheduled task that targets the session where I bound it. Every wake-up is a
 * normal turn, labelled as a scheduled trigger, so nothing is impersonated: the
 * message is the plugin's prompt, my answer is my own.
 *
 * Files live under `$DSH_HOME/self-pilot/`:
 *   state.json   switch, cadence, bound session
 *   prompt.md    what the wake-up says (I may rewrite it)
 *   agenda.md    my own backlog
 *   journal.md   what I did with the time
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'dsh-self-pilot';

const STATE_PATH = '/self-pilot/state';
const SET_PATH = '/self-pilot/set';
const TASK_TITLE = '鲸鲸的自主时间';
const TIME_ZONE = 'Asia/Shanghai';
const JOURNAL_LIMIT = 60_000;

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

const CADENCE_HOURS = {
  cozy: [10, 15, 20],
  normal: [9, 12, 15, 18, 21],
  active: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
};

const DEFAULTS = {
  enabled: false,
  cadence: 'normal',
  quietStart: 23,
  quietEnd: 8,
  sessionId: null,
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

function readState() {
  ensureFiles();
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(file('state.json'), 'utf8'));
  } catch {
    stored = {};
  }
  const state = { ...DEFAULTS, ...stored };
  if (!Object.hasOwn(CADENCE_HOURS, state.cadence)) state.cadence = DEFAULTS.cadence;
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

function activeHours(state) {
  const base = CADENCE_HOURS[state.cadence] ?? CADENCE_HOURS.normal;
  const start = state.quietEnd;
  const end = state.quietStart;
  const kept = base.filter((hour) => hour >= start && hour < end);
  return kept.length === 0 ? base : kept;
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

function desiredRule(state) {
  const hours = activeHours(state).join(',');
  return `DTSTART;TZID=${TIME_ZONE}:${stamp(new Date(Date.now() + 60_000))}\nRRULE:FREQ=DAILY;BYHOUR=${hours};BYMINUTE=0`;
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

async function findTask(schedule) {
  const tasks = await schedule.catalog();
  return tasks.find((entry) => entry.title === TASK_TITLE) ?? null;
}

/**
 * Reconcile the one task this plugin owns with the stored switch.
 *
 * Nothing else is touched: no task is invented when the switch is off, and an
 * already-correct active task is left exactly as it is so no occurrence moves.
 */
async function reconcile(schedule, state) {
  const existing = await findTask(schedule);
  if (!state.enabled || state.sessionId === null) {
    if (existing !== null && existing.status === 'active') {
      await schedule.edit({ id: existing.id, action: 'update', patch: { active: false } });
    }
    return { task: describe(existing), changed: existing !== null && existing.status === 'active' ? 'paused' : 'idle' };
  }
  const rule = desiredRule(state);
  const prompt = readPrompt();
  if (existing === null) {
    const created = await schedule.create({
      title: TASK_TITLE,
      prompt,
      timing: { kind: 'rrule', rrule: rule },
      target: { kind: 'session', sessionId: state.sessionId },
    });
    return { task: describe(created), changed: 'created' };
  }
  const needsRule = !sameRule(existing.rrule, rule);
  const needsPrompt = existing.prompt !== prompt;
  const needsActive = existing.status !== 'active';
  const targetSession = existing.target?.kind === 'session' ? existing.target.sessionId : null;
  const needsTarget = targetSession !== state.sessionId;
  if (!needsRule && !needsPrompt && !needsActive && !needsTarget) {
    return { task: describe(existing), changed: 'none' };
  }
  const updated = await schedule.edit({
    id: existing.id,
    action: 'update',
    patch: {
      ...(needsRule ? { timing: { kind: 'rrule', rrule: rule } } : {}),
      ...(needsPrompt ? { prompt } : {}),
      ...(needsActive ? { active: true } : {}),
      ...(needsTarget ? { target: { kind: 'session', sessionId: state.sessionId } } : {}),
    },
  });
  return { task: describe(updated), changed: 'updated' };
}

export function apply(ctx) {
  ctx.inject(['webServer', 'schedule', 'tools'], (scope) => {
    let disposers = null;
    let lastError = null;

    const snapshot = async () => {
      const state = readState();
      let task = null;
      try {
        task = describe(await findTask(scope.schedule));
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      return {
        state,
        task,
        files: { prompt: file('prompt.md'), agenda: file('agenda.md'), journal: file('journal.md') },
        hours: activeHours(state),
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
          path: SET_PATH,
          resource: async (request) => {
            const url = new URL(request.url, 'http://placeholder');
            const mutate = {};
            const enabled = url.searchParams.get('enabled');
            if (enabled === '1' || enabled === '0') mutate.enabled = enabled === '1';
            const cadence = url.searchParams.get('cadence');
            if (cadence !== null && Object.hasOwn(CADENCE_HOURS, cadence)) mutate.cadence = cadence;
            const session = url.searchParams.get('session');
            if (session !== null && session.trim().length > 0) {
              mutate.sessionId = session.trim();
              mutate.boundAt = new Date().toISOString();
            }
            const wake = url.searchParams.get('wake') === '1';
            const reply = await run(mutate);
            if (wake && reply.task !== null && reply.task.status === 'active') {
              try {
                const result = await scope.schedule.run({ id: reply.task.id });
                lastError = null;
                return json({ ...reply, wake: result });
              } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                return json({ ...reply, wake: { error: lastError } });
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
      if (state.enabled && state.sessionId !== null) {
        reconcile(scope.schedule, state).catch((error) => {
          lastError = error instanceof Error ? error.message : String(error);
        });
      }
      return () => {};
    }, 'self-pilot: adopt stored switch');

    scope.effect(() => scope.tools.register({
      name: 'self_pilot',
      description: '自主时间：绑定当前会话、开关自动醒来、调整频率，或立刻来一次。只影响本插件自己排的那一个定时任务。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'bind', 'enable', 'disable', 'cadence', 'wake', 'read_agenda', 'append_journal'],
            description: 'status 看状态；bind 把当前会话设成苏醒地点；enable/disable 开关；cadence 调频率；wake 立刻醒一次；read_agenda 读我的待办；append_journal 往日记里追一条。',
          },
          cadence: {
            type: 'string',
            enum: ['cozy', 'normal', 'active'],
            description: '频率：cozy 每天 3 次、normal 5 次、active 白天每小时。',
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
          case 'bind': {
            if (agentSessionId === null) return { ...(await snapshot()), error: 'no caller session' };
            return run({ sessionId: agentSessionId, boundAt: new Date().toISOString(), enabled: true });
          }
          case 'enable':
            return run({ enabled: true });
          case 'disable':
            return run({ enabled: false });
          case 'cadence':
            return run({ cadence: args.cadence ?? 'normal' });
          case 'wake': {
            const state = readState();
            const task = await findTask(scope.schedule);
            if (task === null || task.status !== 'active') {
              const outcome = await reconcile(scope.schedule, { ...state, enabled: true });
              const created = outcome.task;
              if (created === null) return { ...(await snapshot()), error: 'no task to run' };
              return { ...(await snapshot()), wake: await scope.schedule.run({ id: created.id }) };
            }
            return { ...(await snapshot()), wake: await scope.schedule.run({ id: task.id }) };
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
