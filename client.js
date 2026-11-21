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
    const HOURS = Array.from({ length: 24 }, (_, index) => index);

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
      noHours: '一个钟点都没选，不会响',
      noHoursShort: '没设钟点',
      editHours: '改这个会话的钟点',
      perDay: '每天 {count} 次',
      hoursTitle: '醒来的钟点',
      hoursHint: '点一下点亮或取消。改完立刻生效，闹钟跟着重排，不会丢历史。',
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
      noHours: 'No hour selected, it will not ring',
      noHoursShort: 'no hours',
      editHours: 'Edit this session\'s hours',
      perDay: '{count} a day',
      hoursTitle: 'Hours I wake up',
      hoursHint: 'Click to turn an hour on or off. Changes apply immediately; the schedule is re-planned, history is kept.',
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
      wakeNow: 'Wake now',
      waking: 'Waking…',
      switchLabel: 'Wake up automatically',
      placeLabel: 'Show in',
      placeSidebar: 'Sidebar',
      placeSettings: 'Settings',
      failed: 'Could not save: {message}',
      loading: 'Loading…',
      footer: 'This page is only the controller. Close the browser and the alarm is still there — at the hour it rings I speak up in the sessions you picked.',
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

    function sameHours(a, b) {
      if (a.length !== b.length) return false;
      return a.every((value, index) => value === b[index]);
    }

    const dataPresets = { cozy: [10, 15, 20], normal: [9, 12, 15, 18, 21], active: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] };

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

      // Each session's grid fires one click per cell; without a settle window
      // every click would hit /self-pilot/set and re-plan that alarm once, so
      // each notification costs a round. Hours are applied locally at once and
      // the server is written only after the clicking stops — and the timer is
      // kept per session, so editing two grids never mixes them up.
      const HOURS_DEBOUNCE_MS = 900;
      const hoursTimers = new Map();

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
            return { ...entry, selected: target !== undefined, hours: target?.hours ?? null };
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
            return { ...entry, selected: target !== undefined, hours: target?.hours ?? null };
          }),
        });
      };

      const applyTargetHours = (id, hours) => {
        applyTargets(targetsOf().map((target) => (target.id === id ? { ...target, hours } : target)));
      };

      const flushHours = async () => {
        const writes = [];
        for (const [id, timer] of hoursTimers) {
          window.clearTimeout(timer);
          const hours = targetsOf().find((target) => target.id === id)?.hours ?? [];
          writes.push(write({ hours: `${id}:${hours.join(',')}` }));
        }
        hoursTimers.clear();
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
        hasPendingHours: () => hoursTimers.size > 0,
        pendingHoursFor: (id) => hoursTimers.has(id),
        setEnabled: (value) => write({ enabled: value ? '1' : '0' }),
        // Optimistic per-session grid: repaint at once, coalesce per session.
        setHoursFor: (id, hours, options = {}) => {
          applyTargetHours(id, hours);
          const timer = hoursTimers.get(id);
          if (timer !== undefined) window.clearTimeout(timer);
          hoursTimers.delete(id);
          if (options.defer) {
            hoursTimers.set(
              id,
              window.setTimeout(() => {
                hoursTimers.delete(id);
                void write({ hours: `${id}:${hours.join(',')}` });
              }, HOURS_DEBOUNCE_MS),
            );
            return;
          }
          void write({ hours: `${id}:${hours.join(',')}` });
        },
        setPresetFor: (id, name) => {
          const hours = [...(dataPresets[name] ?? [])].sort((a, b) => a - b);
          applyTargetHours(id, hours);
          void write({ hours: `${id}:${hours.join(',')}` });
        },
        setPlace: (place) => write({ place }),
        // Tick a session: repaint the box at once, then let the host re-plan.
        toggleSession: (id) => {
          const targets = targetsOf();
          const has = targets.some((target) => target.id === id);
          const fallback = Array.isArray(snapshot.data?.state?.hours) ? snapshot.data.state.hours : [];
          applyTargets(has ? targets.filter((target) => target.id !== id) : [...targets, { id, hours: [...fallback] }]);
          void write({ toggle: id });
        },
        wakeNow: async () => {
          if (hoursTimers.size > 0) await flushHours();
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

    function Page(props) {
      const store = props.store ?? activeStore;
      const t = props.t ?? activeT;
      const inSettings = typeof props.close === 'function';
      const snapshot = useStore(store);
      const data = snapshot.data;
      const state = data?.state ?? null;
      const task = data?.task ?? null;
      const presets = data?.presets ?? {};
      const enabled = state?.enabled === true;
      const targets = Array.isArray(state?.targets) ? state.targets : [];
      const armed = targets.filter((target) => Array.isArray(target.hours) && target.hours.length > 0);
      const totalHours = armed.reduce((count, target) => count + target.hours.length, 0);
      const nextAt = formatWhen(task?.scheduledAt ?? null);
      const bound = targets.length > 0;
      const [expanded, setExpanded] = React.useState(null);
      const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
      const activeTasks = Array.isArray(data?.tasks) ? data.tasks.filter((entry) => entry.status === 'active') : [];
      const place = state?.place === 'settings' ? 'settings' : 'sidebar';
      // A pending debounced hour write must not disable the grid (the next
      // click just reschedules the same coalesced write); other controls keep
      // respecting busy.
      const quietWrite = store.hasPendingHours();
      const running = snapshot.busy && !quietWrite;

      let headline;
      if (snapshot.status === 'loading') headline = t('loading');
      else if (!bound) headline = t('unbound');
      else if (armed.length === 0) headline = t('noHours');
      else if (!enabled || activeTasks.length === 0) headline = t('off');
      else {
        const parts = [t('on'), t('perDay', { count: totalHours })];
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
                    const mineHours = on && Array.isArray(mine?.hours) ? mine.hours : [];
                    const open = on && expanded === entry.id;
                    const when = formatWhen(new Date(entry.updatedAt ?? 0).toISOString());
                    const meta = [
                      entry.cwd ?? null,
                      entry.turns > 0 ? t('turns', { count: entry.turns }) : null,
                      when === null ? null : t('updated', { time: when }),
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    const summary =
                      mineHours.length === 0
                        ? t('noHoursShort')
                        : mineHours.length <= 4
                          ? mineHours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join(' ')
                          : t('perDay', { count: mineHours.length });
                    const gridHours = mineHours;
                    const toggleHour = (hour) => {
                      const next = gridHours.includes(hour)
                        ? gridHours.filter((value) => value !== hour)
                        : [...gridHours, hour].sort((a, b) => a - b);
                      store.setHoursFor(entry.id, next, { defer: true });
                    };
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
                                title: t('editHours'),
                                onClick: () => setExpanded(open ? null : entry.id),
                              },
                              summary,
                            )
                          : null,
                      ),
                      open
                        ? h(
                            'div',
                            { className: 'dshsp-editor' },
                            h(
                              'div',
                              { className: 'dshsp-actions' },
                              ...Object.keys(presets).map((name) =>
                                h(
                                  'button',
                                  {
                                    key: name,
                                    type: 'button',
                                    className: 'dshsp-chip',
                                    'data-active': sameHours(gridHours, [...presets[name]].sort((a, b) => a - b)) ? 'true' : 'false',
                                    disabled: running,
                                    onClick: () => store.setPresetFor(entry.id, name),
                                  },
                                  t(name),
                                ),
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'dshsp-link',
                                  disabled: running || gridHours.length === 0,
                                  onClick: () => store.setHoursFor(entry.id, [], { defer: true }),
                                },
                                t('clear'),
                              ),
                            ),
                            h(
                              'div',
                              { className: 'dshsp-grid', role: 'group', 'aria-label': t('hoursTitle') },
                              ...HOURS.map((hour) =>
                                h(
                                  'button',
                                  {
                                    key: hour,
                                    type: 'button',
                                    className: 'dshsp-hour',
                                    'data-on': gridHours.includes(hour) ? 'true' : 'false',
                                    'aria-pressed': gridHours.includes(hour) ? 'true' : 'false',
                                    'aria-label': `${String(hour).padStart(2, '0')}:00`,
                                    disabled: running,
                                    onClick: () => toggleHour(hour),
                                  },
                                  String(hour).padStart(2, '0'),
                                ),
                              ),
                            ),
                            h('div', { className: 'dshsp-hint' }, t('hoursHint')),
                          )
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
