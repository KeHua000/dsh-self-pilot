/**
 * Client half of dsh-self-pilot.
 *
 * One row in Settings → General: the switch, the presets, and a 24-hour grid so
 * the owner can pick exactly which hours it rings on — no fixed cadence anyone
 * has to live with. Writes go through the plugin's own GET routes: the web
 * server rejects anything but GET/HEAD on resource routes, so state is encoded
 * in the query string.
 */
window.__ModuleLoader__.load({
  id: 'dsh-self-pilot',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'self-pilot';
    const STATE_URL = '/self-pilot/state';
    const SET_URL = '/self-pilot/set';
    const POLL_MS = 15000;
    const HOURS = Array.from({ length: 24 }, (_, index) => index);

    const zh = {
      autoTitle: '自主时间',
      on: '已开启',
      off: '已关闭',
      unbound: '还没绑定会话——让鲸鲸调用一次 self_pilot bind。',
      next: '下次 {time}',
      none: '暂无安排',
      noHours: '一个钟点都没选，不会响',
      perDay: '每天 {count} 次',
      cozy: '清闲',
      normal: '正常',
      active: '活跃',
      wakeNow: '现在来一次',
      waking: '正在醒…',
      hoursLabel: '醒来的钟点',
      failed: '设置失败：{message}',
      clear: '清空',
    };

    const en = {
      autoTitle: 'Own time',
      on: 'On',
      off: 'Off',
      unbound: 'Not bound to a session yet — ask the assistant to run self_pilot bind.',
      next: 'Next {time}',
      none: 'Nothing scheduled',
      noHours: 'No hour selected, it will not ring',
      perDay: '{count} a day',
      cozy: 'Cozy',
      normal: 'Normal',
      active: 'Active',
      wakeNow: 'Wake now',
      waking: 'Waking…',
      hoursLabel: 'Hours it rings',
      failed: 'Could not save: {message}',
      clear: 'Clear',
    };

    const CSS = [
      '.dshsp-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshsp-text{min-width:0;flex:1}',
      '.dshsp-title{font-size:14px;line-height:20px}',
      '.dshsp-description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshsp-controls{display:flex;align-items:center;gap:12px;flex:none;padding-top:2px}',
      '.dshsp-switch{position:relative;width:40px;height:22px;border-radius:11px;border:none;padding:0;cursor:pointer;background:var(--dsw-alias-bg-layer-2);transition:background .15s ease;flex:none}',
      '.dshsp-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dshsp-knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease;box-shadow:0 1px 2px rgb(0 0 0 / 25%)}',
      '.dshsp-switch[aria-checked="true"] .dshsp-knob{transform:translateX(18px)}',
      '.dshsp-extra{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}',
      '.dshsp-chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;cursor:pointer}',
      '.dshsp-chip[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsp-grid{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;max-width:420px}',
      '.dshsp-hour{width:26px;height:24px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:22px;text-align:center;cursor:pointer;padding:0;font-variant-numeric:tabular-nums}',
      '.dshsp-hour[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.dshsp-hour:disabled{opacity:.5;cursor:default}',
      '.dshsp-wake{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;cursor:pointer;padding:2px 4px;text-decoration:underline}',
      '.dshsp-wake:disabled{color:var(--dsw-alias-label-secondary);cursor:default;text-decoration:none}',
      '.dshsp-error{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
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

    function format(value) {
      if (typeof value !== 'string' || value.length === 0) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

    function Row(props) {
      const store = props.store;
      const t = props.t;
      const snapshot = useStore(store);
      const data = snapshot.data;
      const state = data?.state ?? null;
      const task = data?.task ?? null;
      const presets = data?.presets ?? {};
      const enabled = state?.enabled === true;
      const hours = Array.isArray(state?.hours) ? state.hours : [];
      const nextAt = format(task?.scheduledAt ?? null);
      const bound = typeof state?.sessionId === 'string' && state.sessionId.length > 0;

      const parts = [];
      if (!bound) parts.push(t('unbound'));
      else if (hours.length === 0) parts.push(t('noHours'));
      else if (!enabled || task === null || task.status !== 'active') parts.push(t('off'));
      else {
        parts.push(t('on'));
        parts.push(t('perDay', { count: hours.length }));
        parts.push(nextAt === null ? t('none') : t('next', { time: nextAt }));
      }

      const toggleHour = (hour) => {
        const next = hours.includes(hour) ? hours.filter((value) => value !== hour) : [...hours, hour].sort((a, b) => a - b);
        store.setHours(next);
      };

      return h(
        'div',
        { className: 'dshsp-row' },
        h(
          'div',
          { className: 'dshsp-text' },
          h('div', { className: 'dshsp-title' }, t('autoTitle')),
          h('div', { className: 'dshsp-description' }, parts.join(' · ')),
          h(
            'div',
            { className: 'dshsp-extra' },
            ...Object.keys(presets).map((name) =>
              h(
                'button',
                {
                  key: name,
                  type: 'button',
                  className: 'dshsp-chip',
                  'data-active': sameHours(hours, [...presets[name]].sort((a, b) => a - b)) ? 'true' : 'false',
                  disabled: snapshot.busy,
                  onClick: () => store.setPreset(name),
                },
                t(name),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshsp-wake',
                disabled: snapshot.busy || !bound || hours.length === 0,
                onClick: () => store.wakeNow(),
              },
              snapshot.busy ? t('waking') : t('wakeNow'),
            ),
          ),
          h(
            'div',
            { className: 'dshsp-grid', role: 'group', 'aria-label': t('hoursLabel') },
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
                  disabled: snapshot.busy,
                  onClick: () => toggleHour(hour),
                },
                String(hour),
              ),
            ),
          ),
          snapshot.error !== null
            ? h('div', { className: 'dshsp-error', role: 'alert' }, t('failed', { message: snapshot.error }))
            : null,
        ),
        h(
          'div',
          { className: 'dshsp-controls' },
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              className: 'dshsp-switch',
              'aria-checked': enabled ? 'true' : 'false',
              'aria-label': t('autoTitle'),
              disabled: snapshot.busy,
              onClick: () => store.setEnabled(!enabled),
            },
            h('span', { className: 'dshsp-knob' }),
          ),
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
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register({ name: 'settings.general.item', id: 'self-pilot', order: 26, locale: NS, inject: face }, Row),
        );
      },
    };
  },
});
