import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {HostMessage} from 'common/terminal';
import {useEffect, useRef} from 'react';

const invoke = (channel: string, ...args: unknown[]) =>
  window.electron.ipcRenderer.invoke<unknown, unknown>(channel, ...args);

/** One tab's screen: a terminal from the host, attached while this is mounted. */
const TerminalView = ({id, active}: {id: string; active: boolean}) => {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', Menlo, monospace",
      fontSize: 12.5,
      scrollback: 5000,
      allowProposedApi: false,
      theme: {
        background: '#111113',
        foreground: '#e4e4e7',
        cursor: '#2fd9a2',
        selectionBackground: '#2fd9a255',
      },
    });
    const fitter = new FitAddon();
    fit.current = fitter;
    term.loadAddon(fitter);
    term.open(host.current as HTMLDivElement);
    const send = (cols: number, rows: number) =>
      window.electron.ipcRenderer.sendMessage(IPC_MAIN_CHANNELS.TERMINAL_RESIZE as never, [
        id,
        cols,
        rows,
      ]);

    const off = window.electron.ipcRenderer.on<HostMessage>(
      IPC_MAIN_CHANNELS.TERMINAL_EVENT,
      (m) => {
        if (!m || !('id' in m) || m.id !== id) return;
        if (m.type === 'snapshot') {
          term.reset();
          term.write(m.data);
        } else if (m.type === 'data') term.write(m.data);
        else if (m.type === 'exit')
          term.write(`\r\n\x1b[2m[process exited with code ${m.exitCode}]\x1b[0m\r\n`);
      }
    );
    const input = term.onData((data) =>
      window.electron.ipcRenderer.sendMessage(IPC_MAIN_CHANNELS.TERMINAL_INPUT as never, [id, data])
    );
    const resized = term.onResize(({cols, rows}) => send(cols, rows));
    // Attach once the size is known, so the shell draws at it.
    fitter.fit();
    send(term.cols, term.rows);
    invoke(IPC_MAIN_CHANNELS.TERMINAL_ATTACH, id).catch(() => {});
    const observer = new ResizeObserver(() => {
      try {
        fitter.fit();
      } catch {
        /* hidden */
      }
    });
    observer.observe(host.current as HTMLDivElement);
    return () => {
      observer.disconnect();
      input.dispose();
      resized.dispose();
      off?.();
      invoke(IPC_MAIN_CHANNELS.TERMINAL_DETACH, id).catch(() => {});
      term.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (active) {
      try {
        fit.current?.fit();
      } catch {
        /* not laid out yet */
      }
    }
  }, [active]);

  return (
    <div
      ref={host}
      data-testid={`terminal-screen-${id}`}
      className="h-full w-full p-2"
      style={{display: active ? 'block' : 'none'}}
    />
  );
};

export default TerminalView;
