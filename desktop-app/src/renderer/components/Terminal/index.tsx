import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {HostMessage, TerminalInfo} from 'common/terminal';
import {useCallback, useEffect, useState} from 'react';
import {setTerminalOpen, useTerminalOpen} from './store';
import TerminalView from './TerminalView';

const invoke = <R,>(channel: string, ...args: unknown[]) =>
  window.electron.ipcRenderer.invoke<unknown, R>(channel, ...args);

/** The bottom panel: this Session's terminals as tabs. Closing it detaches; the shells keep running. */
const TerminalDock = () => {
  const open = useTerminalOpen();
  const [tabs, setTabs] = useState<TerminalInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState('');

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
      setError(
        String((e as Error).message).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          ''
        )
      );
    }
  }, []);

  // Opening shows what is already running in this Session, or starts the first one.
  useEffect(() => {
    if (!open) return;
    setError('');
    invoke<TerminalInfo[]>(IPC_MAIN_CHANNELS.TERMINAL_LIST)
      .then((list) => {
        setTabs(list);
        if (list.length > 0) setActive((a) => (a && list.some((t) => t.id === a) ? a : list[0].id));
        else add();
        return list;
      })
      .catch((e: Error) =>
        setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      );
  }, [open, add]);

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
      <div
        role="tablist"
        className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]"
      >
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
        {error ? (
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
        {tabs.map((t) => (
          <TerminalView key={t.id} id={t.id} active={t.id === active} />
        ))}
      </div>
    </section>
  );
};

export default TerminalDock;
