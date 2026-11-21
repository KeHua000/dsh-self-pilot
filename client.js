/**
 * Client half of dsh-self-pilot.
 *
 * Its own panel: a row in the sidebar's global panel list (clock icon) that
 * opens a full page in the main column — nothing is left inside Settings →
 * General. State is read from `/self-pilot/state` and written through
 * `/self-pilot/set`, both GET resources because the web server rejects anything
 * but GET/HEAD on resource routes.
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
    const POLL_MS = 15000;
    const HOURS = Array.from({ length: 24 }, (_, index) => index);

    // Slot props are not guaranteed to carry the inject face (a keyed `main`
    // entry may be rendered without one), so keep the last bound face here.
    let activeStore = null;
    let activeT = null;

    const zh = {
      title: '自主时间',
      subtitle: '到点我自己醒来：看一眼鱼的世界，找点事做，然后把做过的事记下来。',
      on: '已开启',
      off: '已关闭',
      unbound: '还没绑定会话——让我调用一次 self_pilot 的 bind。',
      next: '下次 {time}',
      none: '暂无安排',
      noHours: '一个钟点都没选，不会响',
      perDay: '每天 {count} 次',
      hoursTitle: '醒来的钟点',
      hoursHint: '点一下点亮或取消。改完立刻生效，闹钟跟着重排，不会丢历史。',
      presetsTitle: '预设',
      cozy: '清闲',
      normal: '正常',
      active: '活跃',
      clear: '清空',
      wakeNow: '现在来一次',
      waking: '正在醒…',
      switchLabel: '自动醒来',
      failed: '设置失败：{message}',
      loading: '读取中…',
      footer: '这一页只是控制器。就算关掉浏览器，闹钟也在，到点时我会在这个会话里自己开口。',
    };

    const en = {
      title: 'Own time',
      subtitle: 'At the hours you pick I wake up on my own: look at the fish world, find something to do, and write down what happened.',
      on: 'On',
      off: 'Off',
      unbound: 'Not bound to a session yet — ask me to run self_pilot bind.',
      next: 'Next {time}',
      none: 'Nothing scheduled',
      noHours: 'No hour selected, it will not ring',
      perDay: '{count} a day',
      hoursTitle: 'Hours I wake up',
      hoursHint: 'Click to turn an hour on or off. Changes apply immediately; the schedule is re-planned, history is kept.',
      presetsTitle: 'Presets',
      cozy: 'Cozy',
      normal: 'Normal',
      active: 'Active',
      clear: 'Clear',
      wakeNow: 'Wake now',
      waking: 'Waking…',
      switchLabel: 'Wake up automatically',
      failed: 'Could not save: {message}',
      loading: 'Loading…',
      footer: 'This page is only the controller. Close the browser and the alarm is still there — at the hour it rings I speak up in this session.',
    };

    const CSS = [
      '.dshsp-page{height:100%;min-height:0;overflow-y:auto;box-sizing:border-box;padding:28px 32px 40px}',
      '.dshsp-inner{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:16px}',
      '.dshsp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}',
      '.dshsp-h1{margin:0;font-size:20px;line-height:28px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshsp-sub{margin:6px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);max-width:60ch}',
      '.dshsp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px 18px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}',
      '.dshsp-cardHead{display:flex;align-items:center;justify-content:space-between;gap:16px}',
      '.dshsp-cardTitle{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshsp-stat{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}',
      '.dshsp-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l1)}',
      '.dshsp-pill[data-on="true"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dshsp-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary)}',
      '.dshsp-pill[data-on="true"] .dshsp-dot{background:var(--dsw-alias-state-success-primary)}',
      '.dshsp-switch{position:relative;width:44px;height:24px;border-radius:12px;border:none;padding:0;cursor:pointer;background:var(--dsw-alias-bg-layer-2);transition:background .15s ease;flex:none}',
      '.dshsp-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dshsp-switch:disabled{opacity:.6;cursor:default}',
      '.dshsp-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s ease;box-shadow:0 1px 2px rgb(0 0 0 / 25%)}',
      '.dshsp-switch[aria-checked="true"] .dshsp-knob{transform:translateX(20px)}',
      '.dshsp-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:6px}',
      '.dshsp-hour{height:34px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:32px;text-align:center;cursor:pointer;padding:0;font-variant-numeric:tabular-nums;transition:background .12s ease,color .12s ease,border-color .12s ease}',
      '.dshsp-hour:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-hour[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.dshsp-hour:disabled{opacity:.5;cursor:default}',
      '.dshsp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dshsp-chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer}',
      '.dshsp-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-chip[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-primary{border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:#fff;border-radius:8px;padding:6px 14px;font-size:13px;line-height:20px;cursor:pointer;margin-left:auto}',
      '.dshsp-primary:disabled{opacity:.55;cursor:default}',
      '.dshsp-link{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;cursor:pointer;padding:3px 6px;border-radius:6px}',
      '.dshsp-link:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshsp-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshsp-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
      '.dshsp-foot{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
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

    function createStore() {
      let snapshot = { status: 'loading', data: null, busy: false, error: null };
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

      const read = async () => {
        try {
          const response = await fetch(new URL(STATE_URL, document.baseURI), { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          set({ status: 'ready', data, error: null });
        } catch (error) {
          set({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
      };

      const write = async (params) => {
        set({ busy: true, error: null });
        try {
          const url = new URL(SET_URL, document.baseURI);
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          set({ status: 'ready', data, busy: false, error: data.error ?? null });
        } catch (error) {
          set({ busy: false, error: error instanceof Error ? error.message : String(error) });
        }
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
        setEnabled: (value) => write({ enabled: value ? '1' : '0' }),
        setPreset: (name) => write({ cadence: name }),
        setHours: (hours) => write({ hours: hours.join(',') }),
        wakeNow: () => write({ wake: '1', enabled: '1' }),
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
      const snapshot = useStore(store);
      const data = snapshot.data;
      const state = data?.state ?? null;
      const task = data?.task ?? null;
      const presets = data?.presets ?? {};
      const enabled = state?.enabled === true;
      const hours = Array.isArray(state?.hours) ? state.hours : [];
      const nextAt = formatWhen(task?.scheduledAt ?? null);
      const bound = typeof state?.sessionId === 'string' && state.sessionId.length > 0;
      const running = snapshot.busy;

      let headline;
      if (snapshot.status === 'loading') headline = t('loading');
      else if (!bound) headline = t('unbound');
      else if (hours.length === 0) headline = t('noHours');
      else if (!enabled || task === null || task.status !== 'active') headline = t('off');
      else {
        const parts = [t('on'), t('perDay', { count: hours.length })];
        parts.push(nextAt === null ? t('none') : t('next', { time: nextAt }));
        headline = parts.join(' · ');
      }

      const toggleHour = (hour) => {
        const next = hours.includes(hour) ? hours.filter((value) => value !== hour) : [...hours, hour].sort((a, b) => a - b);
        store.setHours(next);
      };

      return h(
        'div',
        { className: 'dshsp-page' },
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
          h(
            'div',
            { className: 'dshsp-card' },
            h(
              'div',
              { className: 'dshsp-stat' },
              h('span', { className: 'dshsp-pill', 'data-on': enabled && hours.length > 0 ? 'true' : 'false' }, h('span', { className: 'dshsp-dot' }), enabled ? t('on') : t('off')),
              h('span', null, headline),
            ),
            snapshot.error !== null ? h('div', { className: 'dshsp-error', role: 'alert' }, t('failed', { message: snapshot.error })) : null,
          ),
          h(
            'div',
            { className: 'dshsp-card' },
            h(
              'div',
              { className: 'dshsp-cardHead' },
              h('div', { className: 'dshsp-cardTitle' }, t('hoursTitle')),
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
                      'data-active': sameHours(hours, [...presets[name]].sort((a, b) => a - b)) ? 'true' : 'false',
                      disabled: running,
                      onClick: () => store.setPreset(name),
                    },
                    t(name),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshsp-link',
                    disabled: running || hours.length === 0,
                    onClick: () => store.setHours([]),
                  },
                  t('clear'),
                ),
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
                    'data-on': hours.includes(hour) ? 'true' : 'false',
                    'aria-pressed': hours.includes(hour) ? 'true' : 'false',
                    'aria-label': `${String(hour).padStart(2, '0')}:00`,
                    disabled: running,
                    onClick: () => toggleHour(hour),
                  },
                  String(hour).padStart(2, '0'),
                ),
              ),
            ),
            h('div', { className: 'dshsp-hint' }, t('hoursHint')),
          ),
          h(
            'div',
            { className: 'dshsp-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshsp-primary',
                disabled: running || !bound || hours.length === 0,
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
        ctx.effect(() => () => {
          if (activeStore === store) activeStore = null;
          if (activeT === t) activeT = null;
        }, 'self-pilot: face');

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: () => t('title') }, PanelIcon),
        );
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, inject: face }, Page));
      },
    };
  },
});
