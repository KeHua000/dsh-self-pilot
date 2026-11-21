/**
 * Client half of dsh-self-pilot.
 *
 * Where the controller lives is the owner's choice, stored with the rest of the
 * state: a sidebar panel with its own page (`sidebar.panellist` + `main`), or a
 * page of its own inside Settings (`settings.section`). Switch at any time on
 * the page itself; the seats are re-registered in place, no reload needed.
 *
 * State is read from `/self-pilot/state` and written through `/self-pilot/set`
 * — GET resources, because the web server rejects anything but GET/HEAD there.
 */
window.__ModuleLoader__.load({
  id: 'dsh-self-pilot',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'self-pilot';
    const PANEL_ID = 'self-pilot';
    const STATE_URL = '/self-pilot/state';
    const SET_URL = '/self-pilot/set';
    const SESSIONS_URL = '/self-pilot/sessions';
    const POLL_MS = 15000;

    // Slot props may arrive without the inject face (a keyed `main` entry can be
    // rendered bare), so keep the bound face here as a fallback.
    let activeStore = null;
    let activeT = null;

    const zh = {
      title: '自主时间',
      subtitle: '到点我自己醒来：看一眼鱼的世界，找点事做，然后把做过的事记下来。',
      on: '已开启',
      off: '已关闭',
      unbound: '还没选会话——在下面挑一个，我就在那里醒。',
      next: '下次 {time}',
      none: '暂无安排',
      noPlan: '一个时段都没设，不会响',
      noPlanShort: '没设时间',
      editPlan: '改这个会话的时间表',
      sessionsTitle: '在哪些会话里醒',
      sessionsHint: '勾上哪个，就在哪个会话里自己开口。可以多选；取消勾选就撤掉那里的闹钟。',
      live: '在线',
      noSessions: '还没读到会话。',
      turns: '{count} 轮',
      updated: '{time} 动过',
      presetsTitle: '预设',
      cozy: '清闲',
      normal: '正常',
      active: '活跃',
      clear: '清空',
      modeAll: '全星期一样',
      modeDays: '按星期分开',
      kindTimes: '按时刻',
      kindWindows: '按时段',
      kindHint: '按时刻 = 只挑几个时间点；按时段 = 从一个时间到另一个时间，中间按间隔醒来。',
      timesTitle: '醒来的时刻',
      timesHint: '点时间可以改，× 删掉；加一个就多一个时刻。',
      addTime: '加一个时刻',
      removeTime: '删掉这个时刻',
      noTimes: '还没有挑时刻。',
      day0: '日',
      day1: '一',
      day2: '二',
      day3: '三',
      day4: '四',
      day5: '五',
      day6: '六',
      dayHint: '点一个星期几，改那一天的安排。',
      copyToAll: '复制到每一天',
      fromLabel: '从',
      toLabel: '到',
      everyLabel: '每隔',
      everyUnit: '分',
      addWindow: '加一段',
      removeWindow: '删掉这段',
      repeatOn: '按间隔',
      repeatOff: '只醒一次',
      repeatHint: '关掉就只在这段的开始时间醒一次。',
      maxLabel: '最多',
      minLabel: '最少',
      timesUnit: '次',
      unlimitedPlaceholder: '不限',
      windowsTitle: '时间段',
      windowsHint: '一天里可以放好几段；每段从开始到结束，每隔几分钟醒一次。结束早于开始就是跨夜。',
      windowsCount: '{count} 段',
      timesPerDay: '每天 {count} 次',
      daysCount: '{count} 天有安排',
      wakeNow: '现在来一次',
      waking: '正在醒…',
      switchLabel: '自动醒来',
      placeLabel: '显示在',
      placeSidebar: '侧栏',
      placeSettings: '设置页',
      failed: '设置失败：{message}',
      loading: '读取中…',
      footer: '这一页只是控制器。就算关掉浏览器，闹钟也在，到点时我会在你选的会话里自己开口。',
    };

    const en = {
      title: 'Own time',
      subtitle: 'At the hours you pick I wake up on my own: look at the fish world, find something to do, and write down what happened.',
      on: 'On',
      off: 'Off',
      unbound: 'No session picked yet — choose one below and that is where I wake up.',
      next: 'Next {time}',
      none: 'Nothing scheduled',
      noPlan: 'No time window selected, it will not ring',
      noPlanShort: 'no schedule',
      editPlan: 'Edit this session\'s schedule',
      sessionsTitle: 'Which sessions I wake in',
      sessionsHint: 'Tick a session and I speak up there. Several are fine; unticking removes that alarm.',
      live: 'Live',
      noSessions: 'No session read yet.',
      turns: '{count} turns',
      updated: 'active {time}',
      presetsTitle: 'Presets',
      cozy: 'Cozy',
      normal: 'Normal',
      active: 'Active',
      clear: 'Clear',
      modeAll: 'Every day the same',
      modeDays: 'Per weekday',
      kindTimes: 'Pick times',
      kindWindows: 'Time windows',
      kindHint: 'Pick times = a few moments of the day. Time windows = a span with an interval inside it.',
      timesTitle: 'Wake-up moments',
      timesHint: 'Tap a time to change it, × to drop it, add one for another moment.',
      addTime: 'Add a moment',
      removeTime: 'Remove this moment',
      noTimes: 'No moments picked yet.',
      day0: 'Su',
      day1: 'Mo',
      day2: 'Tu',
      day3: 'We',
      day4: 'Th',
      day5: 'Fr',
      day6: 'Sa',
      dayHint: 'Pick a weekday to edit that day.',
      copyToAll: 'Copy to every day',
      fromLabel: 'from',
      toLabel: 'to',
      everyLabel: 'every',
      everyUnit: 'min',
      addWindow: 'Add a window',
      removeWindow: 'Remove this window',
      repeatOn: 'On interval',
      repeatOff: 'Once only',
      repeatHint: 'Turn it off to ring once, at the start of this window.',
      maxLabel: 'max',
      minLabel: 'min',
      timesUnit: 'times',
      unlimitedPlaceholder: 'any',
      windowsTitle: 'Time windows',
      windowsHint: 'A day can hold several windows; each rings from its start to its end every N minutes. An end before the start wraps past midnight.',
      windowsCount: '{count} windows',
      timesPerDay: '{count} a day',
      daysCount: '{count} days set',
      wakeNow: 'Wake now',
      waking: 'Waking…',
      switchLabel: 'Wake up automatically',
      placeLabel: 'Show in',
      placeSidebar: 'Sidebar',
      placeSettings: 'Settings',
      failed: 'Could not save: {message}',
      loading: 'Loading…',
      footer: 'This page is only the controller. Close the browser and the alarm is still there — when it rings I speak up in the sessions you picked.',
    };

    const CSS = [
      '.dshsp-page{height:100%;min-height:0;overflow-y:auto;box-sizing:border-box;padding:28px 32px 40px}',
      '.dshsp-page[data-seat="settings"]{padding:20px 0 32px}',
      '.dshsp-inner{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:16px}',
      '.dshsp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}',
      '.dshsp-h1{margin:0;font-size:20px;line-height:28px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshsp-sub{margin:6px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);max-width:60ch}',
      '.dshsp-headRight{display:flex;align-items:center;gap:12px;flex:none}',
      '.dshsp-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px;gap:2px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshsp-segButton{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:3px 10px;border-radius:6px;cursor:pointer}',
      '.dshsp-segButton[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshsp-segButton:hover{color:var(--dsw-alias-label-primary)}',
      '.dshsp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px 18px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}',
      '.dshsp-cardHead{display:flex;align-items:center;justify-content:space-between;gap:16px}',
      '.dshsp-cardTitle{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshsp-stat{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}',
      '.dshsp-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.dshsp-pill[data-on="true"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dshsp-dot{width:6px;height:6px;border-radius:50%;background:currentColor}',
      '.dshsp-switch{position:relative;width:44px;height:24px;border-radius:12px;padding:0;cursor:pointer;flex:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);transition:background .15s ease,border-color .15s ease}',
      '.dshsp-switch[aria-checked="true"]{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.dshsp-switch:disabled{opacity:.6;cursor:default}',
      '.dshsp-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .15s ease;box-shadow:0 1px 2px rgb(0 0 0 / 30%)}',
      '.dshsp-switch[aria-checked="true"] .dshsp-knob{transform:translateX(20px)}',
      '.dshsp-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:6px}',
      '.dshsp-hour{height:34px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:32px;text-align:center;cursor:pointer;padding:0;font-variant-numeric:tabular-nums;transition:background .12s ease,color .12s ease,border-color .12s ease}',
      '.dshsp-hour:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-hour[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600}',
      '.dshsp-hour:disabled{opacity:.5;cursor:default}',
      '.dshsp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dshsp-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer}',
      '.dshsp-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-chip[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dshsp-primary{border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-radius:8px;padding:6px 14px;font-size:13px;line-height:20px;font-weight:600;cursor:pointer;margin-left:auto}',
      '.dshsp-primary:disabled{opacity:.55;cursor:default}',
      '.dshsp-link{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;cursor:pointer;padding:3px 6px;border-radius:6px}',
      '.dshsp-link:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshsp-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshsp-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
      '.dshsp-foot{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshsp-sessions{display:flex;flex-direction:column;gap:2px;max-height:280px;overflow-y:auto}',
      '.dshsp-session{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:transparent;padding:8px 6px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary)}',
      '.dshsp-session:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshsp-box{flex:none;width:16px;height:16px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:var(--dsw-alias-bg-base)}',
      '.dshsp-session[data-on="true"] .dshsp-box{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.dshsp-sessionText{min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dshsp-sessionTitle{font-size:13px;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshsp-sessionMeta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshsp-live{flex:none;margin-left:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-state-success-primary)}',
      '.dshsp-row2{display:flex;align-items:center;gap:8px;border-radius:8px}',
      '.dshsp-row2[data-on="true"]{background:var(--dsw-alias-bg-layer-2)}',
      '.dshsp-row2 .dshsp-session{flex:1;min-width:0}',
      '.dshsp-open{flex:none;max-width:46%;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;padding:4px 8px;border-radius:999px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshsp-open:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-open[data-open="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-editor{display:flex;flex-direction:column;gap:10px;margin:2px 0 10px;padding:12px 12px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}',
      '.dshsp-editor .dshsp-actions{flex-wrap:wrap}',
      '.dshsp-days{display:flex;gap:4px;flex-wrap:wrap}',
      '.dshsp-day{width:30px;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:26px;text-align:center;cursor:pointer;padding:0}',
      '.dshsp-day[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}',
      '.dshsp-day[data-set="true"]{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshsp-windows{display:flex;flex-direction:column;gap:8px}',
      '.dshsp-window2{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);padding-left:2px}',
      '.dshsp-count{width:54px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:3px 6px;text-align:center;font-variant-numeric:tabular-nums}',
      '.dshsp-count:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.dshsp-window{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshsp-time{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:3px 6px;font-variant-numeric:tabular-nums}',
      '.dshsp-time:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.dshsp-every{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:3px 4px}',
      '.dshsp-del{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:18px;padding:2px 6px;border-radius:6px;margin-left:auto}',
      '.dshsp-del:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}',
      '.dshsp-add{border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:4px 10px;font-size:12px;line-height:18px;cursor:pointer;align-self:flex-start}',
      '.dshsp-add:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-empty{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
    ].join('\n');

    function ensureStyle() {
      const existing = document.getElementById('dsh-self-pilot-style');
      if (existing !== null) return () => {};
      const style = document.createElement('style');
      style.id = 'dsh-self-pilot-style';
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }

    function formatWhen(value) {
      if (typeof value !== 'string' || value.length === 0) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    const DAYS = [0, 1, 2, 3, 4, 5, 6];
    const DEFAULT_WINDOW = { start: '09:00', end: '10:00', every: 60 };
    const EVERY_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
    const dataPresets = {
      cozy: {
        times: ['10:00', '15:00', '20:00'],
        windows: [{ start: '10:00', end: '11:00', every: 60 }, { start: '15:00', end: '16:00', every: 60 }, { start: '20:00', end: '21:00', every: 60 }],
      },
      normal: {
        times: ['09:00', '12:00', '15:00', '18:00', '21:00'],
        windows: [{ start: '09:00', end: '10:00', every: 60 }, { start: '12:00', end: '13:00', every: 60 }, { start: '15:00', end: '16:00', every: 60 }, { start: '18:00', end: '19:00', every: 60 }, { start: '21:00', end: '22:00', every: 60 }],
      },
      active: {
        times: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'],
        windows: [{ start: '09:00', end: '23:00', every: 60 }],
      },
    };

    /** Both shapes are kept; `kind` says which one is in force. */
    function dayPlanOf(plan, day) {
      const source = !plan ? null : plan.mode !== 'days' ? plan.all : plan.days?.[String(day)] ?? plan.all;
      return {
        kind: source?.kind === 'times' ? 'times' : 'windows',
        times: Array.isArray(source?.times) ? source.times : [],
        windows: Array.isArray(source?.windows) ? source.windows : [],
      };
    }

    function windowsOf(plan, day) {
      return dayPlanOf(plan, day).windows;
    }

    function timesOf(plan, day) {
      return dayPlanOf(plan, day).times;
    }

    function dayCount(dayPlan) {
      return dayPlan.kind === 'times' ? dayPlan.times.length : dayTimes(dayPlan.windows).length;
    }

    function withDayPlan(plan, day, next) {
      if (!plan) return plan;
      const dayPlan = {
        kind: next.kind === 'times' ? 'times' : 'windows',
        times: Array.isArray(next.times) ? next.times : [],
        windows: Array.isArray(next.windows) ? next.windows : [],
      };
      if (plan.mode !== 'days') {
        const days = {};
        for (const index of DAYS) days[String(index)] = dayPlan;
        return { ...plan, all: dayPlan, days };
      }
      return { ...plan, days: { ...plan.days, [String(day)]: dayPlan } };
    }

    /** Every minute-of-day one window rings at — mirrors the host's expansion. */
    function windowTimes(window) {
      const [sh, sm] = String(window.start ?? '').split(':').map(Number);
      const [eh, em] = String(window.end ?? '').split(':').map(Number);
      if (!Number.isFinite(sh) || !Number.isFinite(eh)) return [];
      const from = sh * 60 + (sm || 0);
      let to = eh * 60 + (em || 0);
      if (to <= from) to += 1440;
      const span = to - from;
      const every = Math.max(1, Number(window.every) || 60);
      let points = [from];
      if (window.repeat !== false) {
        points = [];
        for (let at = from; at < to; at += every) points.push(at);
      }
      const max = Number.isInteger(window.max) ? window.max : null;
      const min = Number.isInteger(window.min) ? window.min : null;
      if (max !== null && points.length > max) {
        const step = points.length / max;
        const kept = [];
        for (let index = 0; index < max; index += 1) kept.push(points[Math.floor(index * step)]);
        points = [...new Set(kept)];
      }
      if (min !== null && points.length < min) {
        const top = new Set(points);
        for (let index = 0; index < min; index += 1) top.add(from + Math.floor((span * index) / Math.max(1, min)));
        points = [...top].sort((a, b) => a - b);
      }
      return points.filter((at) => at < to).map((at) => at % 1440);
    }

    /** Every minute-of-day a day plan rings at. */
    function dayTimes(windows) {
      const times = new Set();
      for (const window of Array.isArray(windows) ? windows : []) {
        for (const at of windowTimes(window)) times.add(at);
      }
      return [...times].sort((a, b) => a - b);
    }

    function planCount(plan) {
      if (!plan) return 0;
      if (plan.mode !== 'days') return dayCount(dayPlanOf(plan, 0));
      let best = 0;
      for (const day of DAYS) best = Math.max(best, dayCount(dayPlanOf(plan, day)));
      return best;
    }

    function planSummary(plan, t) {
      if (!plan) return t('noPlanShort');
      if (plan.mode === 'days') {
        const set = DAYS.filter((day) => dayCount(dayPlanOf(plan, day)) > 0).length;
        return set === 0 ? t('noPlanShort') : t('daysCount', { count: set });
      }
      const dayPlan = dayPlanOf(plan, 0);
      const count = dayCount(dayPlan);
      if (count === 0) return t('noPlanShort');
      if (dayPlan.kind === 'times') return t('timesPerDay', { count });
      return `${t('windowsCount', { count: dayPlan.windows.length })} · ${t('timesPerDay', { count })}`;
    }

    function addMinutes(clock, minutes) {
      const [hh, mm] = String(clock ?? '09:00').split(':').map(Number);
      const total = Math.min(1440, (Number(hh) || 0) * 60 + (Number(mm) || 0) + minutes);
      if (total >= 1440) return '24:00';
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    /** <input type="time"> cannot show 24:00, so the day's end shows as 23:59. */
    function endInput(clock) {
      return clock === '24:00' ? '23:59' : clock;
    }

    function createStore() {
      let snapshot = { status: 'loading', data: null, sessions: [], busy: false, error: null };
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {
            /* a bad subscriber must not break polling */
          }
        }
      };
      const set = (patch) => {
        snapshot = { ...snapshot, ...patch };
        emit();
      };

      // The page lists the sessions it may wake in, so one poll reads both
      // faces: the switch state and the session catalogue.
      const read = async () => {
        try {
          const [stateResponse, sessionsResponse] = await Promise.all([
            fetch(new URL(STATE_URL, document.baseURI), { cache: 'no-store' }),
            fetch(new URL(SESSIONS_URL, document.baseURI), { cache: 'no-store' }),
          ]);
          if (!stateResponse.ok) throw new Error(`HTTP ${stateResponse.status}`);
          const data = await stateResponse.json();
          let sessions = snapshot.sessions;
          if (sessionsResponse.ok) {
            const payload = await sessionsResponse.json();
            if (Array.isArray(payload?.sessions)) sessions = payload.sessions;
          }
          set({ status: 'ready', data, sessions, error: null });
        } catch (error) {
          set({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
      };

      // Editing a window fires on every keystroke and pick; without a settle
      // window each one would hit /self-pilot/set and re-plan that alarm, and
      // each re-plan costs a schedule notification. The plan is applied locally
      // at once and written only after the editing stops — the timer is kept
      // per session, so editing two sessions never mixes them up.
      const PLAN_DEBOUNCE_MS = 900;
      const planTimers = new Map();

      const write = async (params) => {
        set({ busy: true, error: null });
        try {
          const url = new URL(SET_URL, document.baseURI);
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          const targets = Array.isArray(data?.state?.targets) ? data.state.targets : [];
          const sessions = snapshot.sessions.map((entry) => {
            const target = targets.find((item) => item.id === entry.id);
            return { ...entry, selected: target !== undefined, plan: target?.plan ?? null };
          });
          set({ status: 'ready', data, sessions, busy: false, error: data.error ?? null });
        } catch (error) {
          set({ busy: false, error: error instanceof Error ? error.message : String(error) });
        }
      };

      const targetsOf = () => (Array.isArray(snapshot.data?.state?.targets) ? snapshot.data.state.targets : []);

      const applyTargets = (targets) => {
        if (snapshot.data?.state) {
          set({ data: { ...snapshot.data, state: { ...snapshot.data.state, targets } } });
        }
        set({
          sessions: snapshot.sessions.map((entry) => {
            const target = targets.find((item) => item.id === entry.id);
            return { ...entry, selected: target !== undefined, plan: target?.plan ?? null };
          }),
        });
      };

      const planOf = (id) => targetsOf().find((target) => target.id === id)?.plan ?? null;

      const applyTargetPlan = (id, plan) => {
        applyTargets(targetsOf().map((target) => (target.id === id ? { ...target, plan } : target)));
      };

      const flushPlans = async () => {
        const writes = [];
        for (const [id, timer] of planTimers) {
          window.clearTimeout(timer);
          const plan = planOf(id);
          if (plan !== null) writes.push(write({ plan: `${id}:${JSON.stringify(plan)}` }));
        }
        planTimers.clear();
        await Promise.all(writes);
      };

      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        start() {
          let stopped = false;
          const tick = () => {
            if (!stopped && document.visibilityState === 'visible') read();
          };
          read();
          const timer = window.setInterval(tick, POLL_MS);
          const onVisibility = () => {
            if (document.visibilityState === 'visible') read();
          };
          document.addEventListener('visibilitychange', onVisibility);
          return () => {
            stopped = true;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
          };
        },
        hasPendingPlan: () => planTimers.size > 0,
        pendingPlanFor: (id) => planTimers.has(id),
        setEnabled: (value) => write({ enabled: value ? '1' : '0' }),
        // Optimistic per-session plan: repaint at once, coalesce per session.
        setPlanFor: (id, plan, options = {}) => {
          applyTargetPlan(id, plan);
          const timer = planTimers.get(id);
          if (timer !== undefined) window.clearTimeout(timer);
          planTimers.delete(id);
          if (options.defer) {
            planTimers.set(
              id,
              window.setTimeout(() => {
                planTimers.delete(id);
                const current = planOf(id);
                if (current !== null) void write({ plan: `${id}:${JSON.stringify(current)}` });
              }, PLAN_DEBOUNCE_MS),
            );
            return;
          }
          void write({ plan: `${id}:${JSON.stringify(plan)}` });
        },
        setPresetFor: (id, name, day) => {
          const plan = planOf(id);
          const preset = dataPresets[name];
          if (plan === null || !preset) return;
          const current = dayPlanOf(plan, day);
          setPlanFor(id, withDayPlan(plan, day, {
            kind: current.kind,
            times: preset.times.map((time) => time),
            windows: preset.windows.map((window) => ({ ...window })),
          }));
        },
        setPlace: (place) => write({ place }),
        // Tick a session: repaint the box at once, then let the host re-plan.
        toggleSession: (id) => {
          const targets = targetsOf();
          const has = targets.some((target) => target.id === id);
          const fallback = snapshot.data?.state?.plan ?? null;
          applyTargets(has ? targets.filter((target) => target.id !== id) : [...targets, { id, plan: fallback }]);
          void write({ toggle: id });
        },
        wakeNow: async () => {
          if (planTimers.size > 0) await flushPlans();
          void write({ wake: '1', enabled: '1' });
        },
      };
    }

    function useStore(store) {
      const [state, setState] = React.useState(store.getSnapshot());
      React.useEffect(() => {
        setState(store.getSnapshot());
        return store.subscribe(() => setState(store.getSnapshot()));
      }, [store]);
      return state;
    }

    function PanelIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 8.4, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M12 7.4V12l3.3 2.1', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function everyOptions(value) {
      const every = Number(value);
      if (!Number.isFinite(every) || EVERY_CHOICES.includes(every)) return [...EVERY_CHOICES];
      return [...EVERY_CHOICES, every].sort((a, b) => a - b);
    }

    function signatureOf(dayPlan) {
      if (dayPlan?.kind === 'times') return `t:${(dayPlan.times ?? []).join(',')}`;
      return (dayPlan?.windows ?? []).map((window) => `${window.start}-${window.end}-${window.every}`).join('|');
    }

    /**
     * The schedule editor: one plan for every weekday, or one per weekday; a
     * plan is any number of windows, each with its own interval. Every edit is
     * repainted locally at once and written back once the editing settles.
     */
    function PlanEditor(props) {
      const { id, plan, day, onDay, store, t, running } = props;
      const mode = plan?.mode === 'days' ? 'days' : 'all';
      const dayPlan = dayPlanOf(plan, day);
      const kind = dayPlan.kind;
      const windows = dayPlan.windows;
      const times = dayPlan.times;
      const currentSignature = signatureOf(dayPlan);

      const replace = (next, options) => store.setPlanFor(id, withDayPlan(plan, day, next), options);
      const patch = (index, value) =>
        replace({ ...dayPlan, windows: windows.map((window, at) => (at === index ? { ...window, ...value } : window)) }, { defer: true });
      const add = () => {
        const last = windows[windows.length - 1];
        const start = last ? endInput(last.end) : DEFAULT_WINDOW.start;
        replace({
          ...dayPlan,
          windows: [...windows, { start, end: addMinutes(start, 60), every: last?.every ?? DEFAULT_WINDOW.every }],
        }, { defer: true });
      };
      const remove = (index) => replace({ ...dayPlan, windows: windows.filter((_, at) => at !== index) }, { defer: true });

      // "Pick moments": a plain list of clock times, no interval involved.
      const setTimes = (list) => replace({ ...dayPlan, times: list }, { defer: true });
      const patchTime = (index, value) => setTimes(times.map((time, at) => (at === index ? value : time)));
      const addTime = () => {
        const last = times[times.length - 1];
        setTimes([...times, last ? endInput(addMinutes(last, 60)) : '09:00']);
      };
      const removeTime = (index) => setTimes(times.filter((_, at) => at !== index));
      const setKind = (next) => {
        if (next === kind) return;
        store.setPlanFor(id, withDayPlan(plan, day, { ...dayPlan, kind: next }));
      };

      const setMode = (next) => {
        if (next === mode) return;
        if (next === 'all') {
          store.setPlanFor(id, withDayPlan({ ...plan, mode: 'all' }, day, dayPlan));
          return;
        }
        store.setPlanFor(id, { ...plan, mode: 'days' });
      };
      const copyToAll = () => {
        const days = {};
        for (const index of DAYS) days[String(index)] = dayPlan;
        store.setPlanFor(id, { ...plan, mode: 'days', days });
      };

      return h(
        'div',
        { className: 'dshsp-editor' },
        h(
          'div',
          { className: 'dshsp-actions', role: 'group', 'aria-label': t('windowsTitle') },
          h(
            'button',
            {
              type: 'button',
              className: 'dshsp-chip',
              'data-active': mode === 'all' ? 'true' : 'false',
              disabled: running,
              onClick: () => setMode('all'),
            },
            t('modeAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshsp-chip',
              'data-active': mode === 'days' ? 'true' : 'false',
              disabled: running,
              onClick: () => setMode('days'),
            },
            t('modeDays'),
          ),
          mode === 'days'
            ? h('button', { type: 'button', className: 'dshsp-link', disabled: running, onClick: copyToAll }, t('copyToAll'))
            : null,
        ),
        mode === 'days'
          ? h(
              'div',
              { className: 'dshsp-days', role: 'group', 'aria-label': t('dayHint') },
              ...DAYS.map((index) =>
                h(
                  'button',
                  {
                    key: index,
                    type: 'button',
                    className: 'dshsp-day',
                    'data-active': day === index ? 'true' : 'false',
                    'data-set': dayCount(dayPlanOf(plan, index)) > 0 ? 'true' : 'false',
                    'aria-pressed': day === index ? 'true' : 'false',
                    title: t(`day${index}`),
                    disabled: running,
                    onClick: () => onDay(index),
                  },
                  t(`day${index}`),
                ),
              ),
            )
          : null,
        mode === 'days' ? h('div', { className: 'dshsp-hint' }, t('dayHint')) : null,
        // Two ways of saying when to wake up: a handful of moments, or windows
        // with an interval inside them. Both shapes live in the plan at once.
        h(
          'div',
          { className: 'dshsp-actions', role: 'group', 'aria-label': t('kindHint') },
          h(
            'button',
            {
              type: 'button',
              className: 'dshsp-chip',
              'data-active': kind === 'times' ? 'true' : 'false',
              disabled: running,
              onClick: () => setKind('times'),
            },
            t('kindTimes'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshsp-chip',
              'data-active': kind === 'windows' ? 'true' : 'false',
              disabled: running,
              onClick: () => setKind('windows'),
            },
            t('kindWindows'),
          ),
        ),
        kind === 'times'
          ? times.length === 0
            ? h('div', { className: 'dshsp-empty' }, t('noTimes'))
            : h(
                'div',
                { className: 'dshsp-windows', role: 'group', 'aria-label': t('timesTitle') },
                ...times.map((time, index) =>
                  h(
                    'div',
                    { key: index, className: 'dshsp-window' },
                    h('span', null, t('timesTitle')),
                    h('input', {
                      type: 'time',
                      className: 'dshsp-time',
                      value: endInput(time),
                      disabled: running,
                      'aria-label': t('timesTitle'),
                      onChange: (event) => patchTime(index, event.target.value),
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshsp-del',
                        title: t('removeTime'),
                        'aria-label': t('removeTime'),
                        disabled: running,
                        onClick: () => removeTime(index),
                      },
                      '×',
                    ),
                  ),
                ),
              )
          : windows.length === 0
            ? h('div', { className: 'dshsp-empty' }, t('noPlan'))
            : h(
                'div',
                { className: 'dshsp-windows' },
                ...windows.map((window, index) => {
                  const repeats = window.repeat !== false;
                  const count = dayTimes([window]).length;
                  return h(
                    'div',
                    { key: index, className: 'dshsp-chain' },
                    h(
                      'div',
                      { className: 'dshsp-window' },
                      h('span', null, t('fromLabel')),
                      h('input', {
                        type: 'time',
                        className: 'dshsp-time',
                        value: endInput(window.start),
                        disabled: running,
                        'aria-label': t('fromLabel'),
                        onChange: (event) => patch(index, { start: event.target.value }),
                      }),
                      h('span', null, t('toLabel')),
                      h('input', {
                        type: 'time',
                        className: 'dshsp-time',
                        value: endInput(window.end),
                        disabled: running,
                        'aria-label': t('toLabel'),
                        onChange: (event) => patch(index, { end: event.target.value }),
                      }),
                      // The interval itself can be switched off: the window then
                      // rings once, at its start.
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshsp-chip',
                          'data-active': repeats ? 'true' : 'false',
                          'aria-pressed': repeats ? 'true' : 'false',
                          title: t('repeatHint'),
                          disabled: running,
                          onClick: () => patch(index, { repeat: !repeats }),
                        },
                        repeats ? t('repeatOn') : t('repeatOff'),
                      ),
                      repeats
                        ? h(
                            React.Fragment,
                            { key: 'every' },
                            h('span', null, t('everyLabel')),
                            h(
                              'select',
                              {
                                className: 'dshsp-every',
                                value: String(window.every),
                                disabled: running,
                                'aria-label': t('everyLabel'),
                                onChange: (event) => patch(index, { every: Number(event.target.value) }),
                              },
                              ...everyOptions(window.every).map((value) =>
                                h('option', { key: value, value: String(value) }, String(value)),
                              ),
                            ),
                            h('span', null, t('everyUnit')),
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshsp-del',
                          title: t('removeWindow'),
                          'aria-label': t('removeWindow'),
                          disabled: running,
                          onClick: () => remove(index),
                        },
                        '×',
                      ),
                    ),
                    // How many times this window may ring, at most and at least.
                    h(
                      'div',
                      { className: 'dshsp-window2' },
                      h('span', null, t('maxLabel')),
                      h('input', {
                        type: 'number',
                        className: 'dshsp-count',
                        min: 1,
                        max: 96,
                        value: window.max ?? '',
                        placeholder: t('unlimitedPlaceholder'),
                        disabled: running,
                        'aria-label': t('maxLabel'),
                        onChange: (event) =>
                          patch(index, { max: event.target.value === '' ? null : Number(event.target.value) }),
                      }),
                      h('span', null, t('timesUnit')),
                      h('span', null, '·'),
                      h('span', null, t('minLabel')),
                      h('input', {
                        type: 'number',
                        className: 'dshsp-count',
                        min: 1,
                        max: 96,
                        value: window.min ?? '',
                        placeholder: t('unlimitedPlaceholder'),
                        disabled: running,
                        'aria-label': t('minLabel'),
                        onChange: (event) =>
                          patch(index, { min: event.target.value === '' ? null : Number(event.target.value) }),
                      }),
                      h('span', null, t('timesUnit')),
                      h('span', { className: 'dshsp-hint' }, `= ${count} ${t('timesUnit')}`),
                    ),
                  );
                }),
              ),
        h(
          'button',
          {
            type: 'button',
            className: 'dshsp-add',
            disabled: running,
            onClick: kind === 'times' ? addTime : add,
          },
          `+ ${kind === 'times' ? t('addTime') : t('addWindow')}`,
        ),
        h(
          'div',
          { className: 'dshsp-actions' },
          ...Object.keys(dataPresets).map((name) =>
            h(
              'button',
              {
                key: name,
                type: 'button',
                className: 'dshsp-chip',
                'data-active':
                  signatureOf({ kind, times: dataPresets[name].times, windows: dataPresets[name].windows }) === currentSignature
                    ? 'true'
                    : 'false',
                disabled: running,
                onClick: () => store.setPresetFor(id, name, day),
              },
              t(name),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshsp-link',
              disabled: running || dayCount(dayPlan) === 0,
              onClick: () => replace({ ...dayPlan, windows: [], times: [] }),
            },
            t('clear'),
          ),
        ),
        h('div', { className: 'dshsp-hint' }, kind === 'times' ? t('timesHint') : t('windowsHint')),
      );
    }

    function Page(props) {
      const store = props.store ?? activeStore;
      const t = props.t ?? activeT;
      const inSettings = typeof props.close === 'function';
      const snapshot = useStore(store);
      const data = snapshot.data;
      const state = data?.state ?? null;
      const task = data?.task ?? null;
      const enabled = state?.enabled === true;
      const targets = Array.isArray(state?.targets) ? state.targets : [];
      const armed = targets.filter((target) => planCount(target.plan) > 0);
      const perDay = armed.reduce((count, target) => count + planCount(target.plan), 0);
      const nextAt = formatWhen(task?.scheduledAt ?? null);
      const bound = targets.length > 0;
      const [expanded, setExpanded] = React.useState(null);
      const [focusDay, setFocusDay] = React.useState(1);
      const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
      const activeTasks = Array.isArray(data?.tasks) ? data.tasks.filter((entry) => entry.status === 'active') : [];
      const place = state?.place === 'settings' ? 'settings' : 'sidebar';
      // A pending debounced plan write must not disable the editor (the next
      // edit just reschedules the same coalesced write); other controls keep
      // respecting busy.
      const quietWrite = store.hasPendingPlan();
      const running = snapshot.busy && !quietWrite;

      let headline;
      if (snapshot.status === 'loading') headline = t('loading');
      else if (!bound) headline = t('unbound');
      else if (armed.length === 0) headline = t('noPlan');
      else if (!enabled || activeTasks.length === 0) headline = t('off');
      else {
        const parts = [t('on'), t('timesPerDay', { count: perDay })];
        parts.push(nextAt === null ? t('none') : t('next', { time: nextAt }));
        headline = parts.join(' · ');
      }

      const choosePlace = (next) => {
        if (next === place) return;
        store.setPlace(next);
        if (next === 'sidebar' && inSettings) props.close();
      };

      return h(
        'div',
        { className: 'dshsp-page', 'data-seat': inSettings ? 'settings' : 'page' },
        h(
          'div',
          { className: 'dshsp-inner' },
          h(
            'div',
            { className: 'dshsp-head' },
            h(
              'div',
              null,
              h('h1', { className: 'dshsp-h1' }, t('title')),
              h('p', { className: 'dshsp-sub' }, t('subtitle')),
            ),
            h(
              'div',
              { className: 'dshsp-headRight' },
              h(
                'div',
                { className: 'dshsp-seg', role: 'group', 'aria-label': t('placeLabel') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshsp-segButton',
                    'data-active': place === 'sidebar' ? 'true' : 'false',
                    disabled: running,
                    onClick: () => choosePlace('sidebar'),
                  },
                  t('placeSidebar'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshsp-segButton',
                    'data-active': place === 'settings' ? 'true' : 'false',
                    disabled: running,
                    onClick: () => choosePlace('settings'),
                  },
                  t('placeSettings'),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  className: 'dshsp-switch',
                  'aria-checked': enabled ? 'true' : 'false',
                  'aria-label': t('switchLabel'),
                  disabled: running,
                  onClick: () => store.setEnabled(!enabled),
                },
                h('span', { className: 'dshsp-knob' }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dshsp-card' },
            h(
              'div',
              { className: 'dshsp-stat' },
              h('span', { className: 'dshsp-pill', 'data-on': enabled && armed.length > 0 ? 'true' : 'false' }, h('span', { className: 'dshsp-dot' }), enabled ? t('on') : t('off')),
              h('span', null, headline),
            ),
            snapshot.error !== null ? h('div', { className: 'dshsp-error', role: 'alert' }, t('failed', { message: snapshot.error })) : null,
          ),
          h(
            'div',
            { className: 'dshsp-card' },
            h('div', { className: 'dshsp-cardHead' }, h('div', { className: 'dshsp-cardTitle' }, t('sessionsTitle'))),
            sessions.length === 0
              ? h('div', { className: 'dshsp-hint' }, t('noSessions'))
              : h(
                  'div',
                  { className: 'dshsp-sessions', role: 'group', 'aria-label': t('sessionsTitle') },
                  ...sessions.map((entry) => {
                    const on = entry.selected === true;
                    const mine = targets.find((target) => target.id === entry.id) ?? null;
                    const open = on && expanded === entry.id;
                    const when = formatWhen(new Date(entry.updatedAt ?? 0).toISOString());
                    const meta = [
                      entry.cwd ?? null,
                      entry.turns > 0 ? t('turns', { count: entry.turns }) : null,
                      when === null ? null : t('updated', { time: when }),
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    const summary = planSummary(mine?.plan ?? null, t);
                    return h(
                      React.Fragment,
                      { key: entry.id },
                      h(
                        'div',
                        { className: 'dshsp-row2', 'data-on': on ? 'true' : 'false' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshsp-session',
                            'data-on': on ? 'true' : 'false',
                            'aria-pressed': on ? 'true' : 'false',
                            disabled: running,
                            title: entry.id,
                            onClick: () => store.toggleSession(entry.id),
                          },
                          h('span', { className: 'dshsp-box', 'aria-hidden': 'true' }, on ? '✓' : ''),
                          h(
                            'span',
                            { className: 'dshsp-sessionText' },
                            h('span', { className: 'dshsp-sessionTitle' }, entry.title ?? entry.id),
                            meta.length > 0 ? h('span', { className: 'dshsp-sessionMeta' }, meta) : null,
                          ),
                          entry.live === true ? h('span', { className: 'dshsp-live' }, t('live')) : null,
                        ),
                        on
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'dshsp-open',
                                'data-open': open ? 'true' : 'false',
                                'aria-expanded': open ? 'true' : 'false',
                                disabled: running,
                                title: t('editPlan'),
                                onClick: () => setExpanded(open ? null : entry.id),
                              },
                              summary,
                            )
                          : null,
                      ),
                      open
                        ? h(PlanEditor, {
                            id: entry.id,
                            plan: mine?.plan ?? state?.plan ?? null,
                            day: focusDay,
                            onDay: setFocusDay,
                            store,
                            t,
                            running,
                          })
                        : null,
                    );
                  }),
                ),
            h('div', { className: 'dshsp-hint' }, t('sessionsHint')),
          ),
          h(
            'div',
            { className: 'dshsp-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshsp-primary',
                disabled: running || armed.length === 0,
                onClick: () => store.wakeNow(),
              },
              running ? t('waking') : t('wakeNow'),
            ),
          ),
          h('div', { className: 'dshsp-foot' }, t('footer')),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'self-pilot: dictionaries');
        ctx.effect(ensureStyle, 'self-pilot: styles');
        const store = createStore();
        ctx.effect(() => store.start(), 'self-pilot: poll');
        const t = ctx.locale.bind(NS);
        const face = () => ({ store, t });
        activeStore = store;
        activeT = t;

        const seat = (slotName, options, component) =>
          ctx.slots.inject(slotName, () => ctx.slots.register({ ...options, name: slotName, inject: face }, component));

        let disposers = [];
        let mounted = null;
        const unmount = () => {
          for (const dispose of disposers) {
            try {
              dispose();
            } catch {
              /* already gone */
            }
          }
          disposers = [];
        };
        const mount = () => {
          const place = store.getSnapshot().data?.state?.place === 'settings' ? 'settings' : 'sidebar';
          if (place === mounted) return;
          unmount();
          mounted = place;
          if (place === 'settings') {
            disposers.push(seat('settings.section', { id: PANEL_ID, order: 44, label: () => t('title') }, Page));
          } else {
            disposers.push(seat('sidebar.panellist', { id: PANEL_ID, order: 12, label: () => t('title') }, PanelIcon));
            disposers.push(seat('main', { key: PANEL_ID }, Page));
          }
        };

        ctx.effect(() => {
          mount();
          const unsubscribe = store.subscribe(mount);
          return () => {
            unsubscribe();
            unmount();
            if (activeStore === store) activeStore = null;
            if (activeT === t) activeT = null;
          };
        }, 'self-pilot: seats');
      },
    };
  },
});
