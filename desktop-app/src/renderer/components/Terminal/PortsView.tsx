import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {PortInfo} from 'common/tunnel';
import {useEffect, useState} from 'react';
import {useDispatch} from 'react-redux';
import {setAddress} from 'renderer/store/features/renderer';

/** Ports this Session's terminals opened (and its tunnels), found by looking at the Mac, not guessed. */
const PortsView = () => {
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [error, setError] = useState('');
  const dispatch = useDispatch();

  useEffect(() => {
    let alive = true;
    const look = () =>
      window.electron.ipcRenderer
        .invoke<unknown, PortInfo[]>(IPC_MAIN_CHANNELS.PORTS_LIST)
        .then((list) => {
          if (alive) {
            setPorts(list);
            setError('');
          }
          return list;
        })
        .catch((e: Error) => alive && setError(e.message));
    look();
    const timer = setInterval(look, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div data-testid="ports-view" className="h-full overflow-auto px-4 py-3 text-[12.5px]">
      {error ? (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      ) : null}
      {ports && ports.length === 0 ? (
        <p className="text-muted">
          No ports yet. Start a dev server in a terminal here (for example <code>npm run dev</code>)
          and it shows up within a couple of seconds.
        </p>
      ) : null}
      {ports?.map((p) => (
        <div
          key={`${p.pid}:${p.port}`}
          className="flex items-center gap-3 border-b border-line py-[7px]"
        >
          <span className="w-[64px] font-mono text-[13px] font-bold">{p.port}</span>
          <span className="flex-1">
            {p.tunnel ? `Tunnel: ${p.tunnel}` : p.process}
            <span className="ml-2 text-muted">
              {p.source === 'tunnel' ? 'ssh' : `pid ${p.pid}`}
            </span>
          </span>
          <button
            type="button"
            onClick={() => dispatch(setAddress(`http://localhost:${p.port}`))}
            className="h-7 rounded-[7px] border border-line px-3 hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Open in previews
          </button>
        </div>
      ))}
    </div>
  );
};

export default PortsView;
