import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {describeState, type TunnelDef, type TunnelInfo} from 'common/tunnel';
import {useCallback, useEffect, useState} from 'react';
import {useDispatch} from 'react-redux';
import {setAddress} from 'renderer/store/features/renderer';

const invoke = <R,>(channel: string, ...args: unknown[]) =>
  window.electron.ipcRenderer.invoke<unknown, R>(channel, ...args);
const clean = (e: Error) =>
  e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const EMPTY: TunnelDef = {
  id: '',
  name: '',
  host: '',
  remote: 'localhost:',
  localPort: 0,
  anyPort: true,
  autoStart: false,
};

/** States where ssh is running or about to: not editable. */
const RUNNING = ['connecting', 'connected', 'reconnecting'];

const COLOR: Record<string, string> = {
  connected: 'bg-accent',
  connecting: 'bg-yellow-400',
  reconnecting: 'bg-yellow-400',
  'auth-required': 'bg-red-400',
  'port-conflict': 'bg-red-400',
  failed: 'bg-red-400',
  stopped: 'bg-muted',
};

/** Saved SSH tunnels: a server's service reachable on this Mac's loopback, with status that is proved, not assumed. */
const TunnelsView = () => {
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [form, setForm] = useState<TunnelDef | null>(null);
  const [error, setError] = useState('');
  const dispatch = useDispatch();

  const load = useCallback(
    () =>
      invoke<TunnelInfo[]>(IPC_MAIN_CHANNELS.TUNNELS_LIST)
        .then((list) => {
          setTunnels(list);
          return list;
        })
        .catch((e: Error) => setError(clean(e))),
    []
  );

  useEffect(() => {
    load();
    invoke<string[]>(IPC_MAIN_CHANNELS.SSH_HOSTS)
      .then((h) => {
        setHosts(h);
        return h;
      })
      .catch(() => {});
    return window.electron.ipcRenderer.on<TunnelInfo>(IPC_MAIN_CHANNELS.TUNNEL_EVENT, (info) => {
      if (info) setTunnels((list) => list.map((t) => (t.def.id === info.def.id ? info : t)));
    });
  }, [load]);

  const act = (fn: () => Promise<unknown>) => {
    setError('');
    fn()
      .then(() => load())
      .catch((e: Error) => setError(clean(e)));
  };

  const save = () => {
    if (!form) return;
    setError('');
    invoke<TunnelDef>(IPC_MAIN_CHANNELS.TUNNEL_SAVE, form)
      .then(() => {
        setForm(null);
        return load();
      })
      .catch((e: Error) => setError(clean(e)));
  };

  return (
    <div data-testid="tunnels-view" className="h-full overflow-auto px-4 py-3 text-[12.5px]">
      {error ? (
        <p role="alert" className="mb-2 text-red-400">
          {error}
        </p>
      ) : null}
      {tunnels.length === 0 && !form ? (
        <p className="mb-2 text-muted">
          A tunnel makes a service on one of your servers (a ComfyUI on a GPU box, a dev server)
          answer on this Mac, so the previews can open it. It runs your own <code>ssh</code>, so
          your <code>~/.ssh/config</code> and keys just work and nothing is copied.
        </p>
      ) : null}
      {tunnels.map((t) => (
        <div key={t.def.id} className="flex items-center gap-3 border-b border-line py-[7px]">
          <span
            aria-hidden
            className={cx('h-2 w-2 flex-shrink-0 rounded-full', COLOR[t.state] ?? 'bg-muted')}
          />
          <span className="min-w-0 flex-1">
            <b>{t.def.name}</b>{' '}
            <span className="text-muted">
              {t.def.host} → {t.def.remote} · localhost:
              {t.state === 'stopped' ? t.def.localPort : t.localPort}
            </span>
            <span className="block text-[11.5px]">
              {describeState(t.state)}
              {t.state === 'reconnecting' ? ` (attempt ${t.attempts})` : ''}
              {t.detail ? <span className="text-muted"> · {t.detail}</span> : null}
            </span>
          </span>
          {t.state === 'connected' ? (
            <button
              type="button"
              onClick={() => dispatch(setAddress(`http://localhost:${t.localPort}`))}
              className="h-7 rounded-[7px] border border-line px-3 hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              Open in previews
            </button>
          ) : null}
          {t.state === 'stopped' ||
          t.state === 'failed' ||
          t.state === 'auth-required' ||
          t.state === 'port-conflict' ? (
            <button
              type="button"
              aria-label={`Start ${t.def.name}`}
              onClick={() => act(() => invoke(IPC_MAIN_CHANNELS.TUNNEL_START, t.def.id))}
              className="h-7 rounded-[7px] bg-accent px-3 font-bold text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-fg"
            >
              Start
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Stop ${t.def.name}`}
              onClick={() => act(() => invoke(IPC_MAIN_CHANNELS.TUNNEL_STOP, t.def.id))}
              className="h-7 rounded-[7px] border border-line px-3 hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            aria-label={`Edit ${t.def.name}`}
            disabled={RUNNING.includes(t.state)}
            title={RUNNING.includes(t.state) ? 'Stop it first' : undefined}
            onClick={() => setForm(t.def)}
            className="h-7 rounded-[7px] px-2 text-muted hover:bg-hover disabled:opacity-40"
          >
            Edit
          </button>
          <button
            type="button"
            aria-label={`Delete ${t.def.name}`}
            onClick={() => act(() => invoke(IPC_MAIN_CHANNELS.TUNNEL_DELETE, t.def.id))}
            className="h-7 rounded-[7px] px-2 text-muted hover:bg-hover"
          >
            ✕
          </button>
        </div>
      ))}
      {form ? (
        <div className="mt-3 grid max-w-[560px] grid-cols-[130px_1fr] items-center gap-x-3 gap-y-2">
          <label htmlFor="tn-name">Name</label>
          <input
            id="tn-name"
            value={form.name}
            onChange={(e) => setForm({...form, name: e.target.value})}
            placeholder="ComfyUI on gpu-box"
            className="h-7 rounded-md border border-line bg-transparent px-2"
          />
          <label htmlFor="tn-host">Server</label>
          <input
            id="tn-host"
            list="tn-hosts"
            value={form.host}
            onChange={(e) => setForm({...form, host: e.target.value})}
            placeholder="an alias from ~/.ssh/config, or user@host"
            className="h-7 rounded-md border border-line bg-transparent px-2"
          />
          <datalist id="tn-hosts">
            {hosts.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
          <label htmlFor="tn-remote">Service on the server</label>
          <input
            id="tn-remote"
            value={form.remote}
            onChange={(e) => setForm({...form, remote: e.target.value})}
            placeholder="localhost:8188"
            className="h-7 rounded-md border border-line bg-transparent px-2 font-mono"
          />
          <label htmlFor="tn-port">Port on this Mac</label>
          <input
            id="tn-port"
            inputMode="numeric"
            value={form.localPort || ''}
            onChange={(e) =>
              setForm({...form, localPort: Number(e.target.value.replace(/\D/g, ''))})
            }
            placeholder="8188"
            className="h-7 rounded-md border border-line bg-transparent px-2 font-mono"
          />
          <span />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.anyPort}
              onChange={() => setForm({...form, anyPort: !form.anyPort})}
              className="m-0 accent-accent"
            />
            If that port is taken, use another free one
          </label>
          <span />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.autoStart}
              onChange={() => setForm({...form, autoStart: !form.autoStart})}
              className="m-0 accent-accent"
            />
            Start when this Session opens
          </label>
          <span />
          <span className="flex gap-2">
            <button
              type="button"
              onClick={save}
              className="h-7 rounded-md bg-accent px-3 font-bold text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-fg"
            >
              Save tunnel
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="h-7 rounded-md border border-line px-3 hover:bg-hover"
            >
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setForm({...EMPTY})}
          className="mt-3 text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          + New tunnel
        </button>
      )}
    </div>
  );
};

export default TunnelsView;
