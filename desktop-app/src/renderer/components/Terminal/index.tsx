import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {HostMessage, TerminalInfo} from 'common/terminal';
import {useCallback, useEffect, useState} from 'react';
import PortsView from './PortsView';
import {setDockView, setTerminalOpen, useDockView, useTerminalOpen, type DockView} from './store';
import TerminalView from './TerminalView';
import TunnelsView from './TunnelsView';
import EnvironmentView from './EnvironmentView';
import {useSandbox} from './useSandbox';

const invoke = <R,>(channel: string, ...args: unknown[]) =>
  window.electron.ipcRenderer.invoke<unknown, R>(channel, ...args);
const clean = (e: Error) =>
  e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const PHASE_WORD: Record<string, string> = {
  none: 'not created',
  'missing-runtime': 'colima missing',
};

const VIEWS: {id: DockView; label: string}[] = [
  {id: 'terminal', label: 'Terminal'},
  {id: 'ports', label: 'Ports'},
  {id: 'tunnels', label: 'Tunnels'},
  {id: 'environment', label: 'Environment'},
];

/**
 * The bottom panel: this Session's terminals as tabs, the ports they opened, and
 * its SSH tunnels. Closing it detaches; the shells and tunnels keep running.
 */
const TerminalDock = () => {
  const open = useTerminalOpen();
  const view = useDockView();
  const {state: sandbox} = useSandbox();
  const inSandbox = sandbox?.settings.mode === 'sandbox';
  const sandboxUp = sandbox?.phase === 'running';
  const blocked = inSandbox && !sandboxUp;
  const [tabs, setTabs] = useState<TerminalInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Whether the list of tabs has been read for this environment, so "none" means none.
  const [listed, setListed] = useState(false);

  const add = useCallback(async () => {
    setError('');
    try {
      const info = await invoke<TerminalInfo>(IPC_MAIN_CHANNELS.TERMINAL_CREATE, {
        cols: 100,
        rows: 16,
      });
      setTabs((t) => [...t, info]);
      setActive(info.id);
    } catch (e) {
      setError(clean(e as Error));
    }
  }, []);

  // Opening shows what is already running in this Session, or starts the first one.
  useEffect(() => {
    if (!open) return;
    setError('');
    invoke<TerminalInfo[]>(IPC_MAIN_CHANNELS.TERMINAL_LIST)
      .then((list) => {
        setTabs(list);
        setListed(true);
        if (list.length > 0) setActive((a) => (a && list.some((t) => t.id === a) ? a : list[0].id));
        return list;
      })
      .catch((e: Error) => setError(clean(e)));
    // Only when the panel opens: switching views must not start shells.
  }, [open, add]);

  // Switching between Local and Sandbox (or the sandbox starting or stopping) shows that place's tabs.
  const environment = `${sandbox?.settings.mode}:${sandbox?.phase === 'running'}`;
  useEffect(() => {
    if (!open) return;
    setListed(false);
    invoke<TerminalInfo[]>(IPC_MAIN_CHANNELS.TERMINAL_LIST)
      .then((list) => {
        setTabs(list);
        setActive(list[0]?.id ?? null);
        setListed(true);
        return list;
      })
      .catch(() => {
        setTabs([]);
        setListed(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment]);

  // Looking at an empty Terminal view starts the first tab, in whichever environment is current
  // (closing the last tab yourself does not start another).
  useEffect(() => {
    if (open && listed && view === 'terminal' && !blocked && tabs.length === 0) add();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listed, view, blocked]);

  // A tab closed elsewhere disappears here too.
  useEffect(
    () =>
      window.electron.ipcRenderer.on<HostMessage>(IPC_MAIN_CHANNELS.TERMINAL_EVENT, (m) => {
        if (m?.type === 'closed') setTabs((t) => t.filter((x) => x.id !== m.id));
        if (m?.type === 'exit')
          setTabs((t) =>
            t.map((x) => (x.id === m.id ? {...x, state: 'exited', exitCode: m.exitCode} : x))
          );
      }),
    []
  );

  useEffect(() => {
    if (active && !tabs.some((t) => t.id === active)) setActive(tabs[0]?.id ?? null);
  }, [tabs, active]);

  if (!open) return null;
  return (
    <section
      aria-label="Terminal"
      data-testid="terminal-dock"
      className="flex h-[300px] flex-shrink-0 flex-col border-t border-line bg-[#111113]"
    >
      <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]">
        <div
          role="group"
          aria-label="Panel"
          className="mr-2 flex gap-[2px] rounded-lg border border-line p-[2px]"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => setDockView(v.id)}
              className={`h-[22px] rounded-md px-[9px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                view === v.id ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view === 'terminal' ? (
          <div role="tablist" className="flex items-center gap-1">
            {tabs.map((t) => (
              <span
                key={t.id}
                className={`flex items-center gap-1 rounded-md px-2 py-1 ${
                  t.id === active ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={t.id === active}
                  onClick={() => setActive(t.id)}
                  className="focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  {t.title}
                  {t.state === 'exited' ? ' (ended)' : ''}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${t.title}`}
                  onClick={() => invoke(IPC_MAIN_CHANNELS.TERMINAL_CLOSE, t.id).catch(() => {})}
                  className="text-muted hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              type="button"
              aria-label="New terminal"
              onClick={add}
              className="h-6 w-6 rounded-md text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              +
            </button>
          </div>
        ) : null}
        <span
          data-testid="environment-chip"
          className={`mr-1 rounded-full px-2 py-[2px] text-[11px] ${
            inSandbox
              ? sandboxUp
                ? 'bg-accent-soft text-accent'
                : 'bg-hover text-muted'
              : 'bg-yellow-400/15 text-yellow-400'
          }`}
        >
          {inSandbox
            ? `Sandbox · ${PHASE_WORD[sandbox?.phase ?? 'none'] ?? sandbox?.phase}`
            : 'Local · your Mac'}
        </span>
        {error && view === 'terminal' ? (
          <span role="alert" className="ml-2 text-red-400">
            {error}
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="text-[11px] text-muted">Runs on this Mac · keeps running when closed</span>
        <button
          type="button"
          aria-label="Close the terminal panel"
          onClick={() => setTerminalOpen(false)}
          className="h-6 w-6 rounded-md text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          ▾
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'ports' ? <PortsView /> : null}
        {view === 'tunnels' ? <TunnelsView /> : null}
        {view === 'environment' ? <EnvironmentView /> : null}
        {view === 'terminal' && blocked ? (
          <div className="p-4 text-[12.5px] text-muted">
            The sandbox is {sandbox?.phase === 'none' ? 'not created yet' : 'not running'}.{' '}
            <button
              type="button"
              onClick={() => setDockView('environment')}
              className="text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              Open Environment
            </button>{' '}
            to {sandbox?.phase === 'none' ? 'create' : 'start'} it.
          </div>
        ) : null}
        <div
          className="h-full"
          style={{display: view === 'terminal' && !blocked ? 'block' : 'none'}}
        >
          {tabs.map((t) => (
            <TerminalView key={t.id} id={t.id} active={t.id === active && view === 'terminal'} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default TerminalDock;
