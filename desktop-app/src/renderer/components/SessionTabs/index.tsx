import {Icon} from '@iconify/react';
import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {SessionInfo} from 'common/sessions';
import {useCallback, useEffect, useRef, useState} from 'react';
import useKeyboardShortcut, {
  SHORTCUT_CHANNEL,
} from '../KeyboardShortcutsManager/useKeyboardShortcut';

const newSession = (placement: 'tab' | 'window') =>
  window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.SESSION_NEW, {placement}).catch(() => {});
const newTab = () => newSession('tab');
const newWindow = () => newSession('window');

/**
 * Running Sessions as tabs. Each Session is still its own window (macOS can't
 * tab windows across processes), so switching moves the chosen Session's
 * window to this exact spot and brings it to the front.
 */
const SessionTabs = () => {
  const [tabs, setTabs] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const state = useRef({tabs, currentId});
  state.current = {tabs, currentId};

  const refresh = useCallback(async () => {
    try {
      const [list, context] = await Promise.all([
        window.electron.ipcRenderer.invoke<{operation: 'list'}, SessionInfo[]>(
          IPC_MAIN_CHANNELS.SESSIONS_REQUEST,
          {operation: 'list'}
        ),
        window.electron.ipcRenderer.invoke<never, {id?: string}>(IPC_MAIN_CHANNELS.SESSION_CONTEXT),
      ]);
      setTabs(list.filter((s) => s.status === 'running'));
      setCurrentId(context?.id);
    } catch {
      /* the controller may be starting; the next refresh catches up */
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Each refresh asks every Session for its status: only the window you are in polls.
    const timer = setInterval(() => {
      if (document.hasFocus()) void refresh();
    }, 2000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const switchTo = (id: string) => {
    if (id !== state.current.currentId)
      window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.SESSION_SWITCH, id).catch(() => {});
  };
  const step = useCallback((offset: number) => {
    const {tabs: list, currentId: id} = state.current;
    if (list.length === 0) return;
    const index = list.findIndex((s) => s.id === id);
    const next = list[(index + offset + list.length) % list.length];
    if (next.id !== id)
      window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.SESSION_SWITCH, next.id).catch(() => {});
  }, []);
  const nextTab = useCallback(() => step(1), [step]);
  const previousTab = useCallback(() => step(-1), [step]);

  useKeyboardShortcut(SHORTCUT_CHANNEL.NEXT_SESSION, nextTab);
  useKeyboardShortcut(SHORTCUT_CHANNEL.PREVIOUS_SESSION, previousTab);
  useKeyboardShortcut(SHORTCUT_CHANNEL.NEW_SESSION_TAB, newTab);
  useKeyboardShortcut(SHORTCUT_CHANNEL.NEW_SESSION_WINDOW, newWindow);

  if (tabs.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Sessions"
      data-testid="session-tabs"
      className="flex h-[34px] flex-shrink-0 items-end gap-[2px] overflow-x-auto border-b border-line-soft bg-bg px-2"
    >
      {tabs.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={s.id === currentId}
          data-testid={`session-tab-${s.id}`}
          title={s.id === currentId ? s.name : `Switch to ${s.name} (Ctrl+Tab)`}
          onClick={() => switchTo(s.id)}
          className={cx(
            'max-w-[200px] truncate rounded-t-[7px] px-3 py-[6px] text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            s.id === currentId
              ? 'bg-panel font-semibold text-fg'
              : 'text-muted hover:bg-hover hover:text-fg'
          )}
        >
          {s.name}
        </button>
      ))}
      <button
        type="button"
        title="New Session tab (⌘T)"
        aria-label="New Session tab"
        onClick={newTab}
        className="mb-[3px] flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <Icon icon="lucide:plus" fontSize={15} />
      </button>
    </div>
  );
};

export default SessionTabs;
