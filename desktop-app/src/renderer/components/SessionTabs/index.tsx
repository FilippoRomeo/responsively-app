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
  // ⌘1…⌘8 pick that tab, ⌘9 the last one, as in browsers.
  const nth = useCallback((n: number) => {
    const {tabs: list, currentId: id} = state.current;
    const target = n < 0 ? list[list.length - 1] : list[n];
    if (target && target.id !== id)
      window.electron.ipcRenderer
        .invoke(IPC_MAIN_CHANNELS.SESSION_SWITCH, target.id)
        .catch(() => {});
  }, []);
  const tab1 = useCallback(() => nth(0), [nth]);
  const tab2 = useCallback(() => nth(1), [nth]);
  const tab3 = useCallback(() => nth(2), [nth]);
  const tab4 = useCallback(() => nth(3), [nth]);
  const tab5 = useCallback(() => nth(4), [nth]);
  const tab6 = useCallback(() => nth(5), [nth]);
  const tab7 = useCallback(() => nth(6), [nth]);
  const tab8 = useCallback(() => nth(7), [nth]);
  const tabLast = useCallback(() => nth(-1), [nth]);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_1, tab1);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_2, tab2);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_3, tab3);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_4, tab4);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_5, tab5);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_6, tab6);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_7, tab7);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_8, tab8);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SESSION_TAB_LAST, tabLast);

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
        <div
          key={s.id}
          className={cx(
            'group flex max-w-[220px] items-center rounded-t-[7px]',
            s.id === currentId ? 'bg-panel' : 'hover:bg-hover'
          )}
        >
          <button
            type="button"
            role="tab"
            aria-selected={s.id === currentId}
            data-testid={`session-tab-${s.id}`}
            title={s.id === currentId ? s.name : `Switch to ${s.name} (Ctrl+Tab)`}
            onClick={() => switchTo(s.id)}
            className={cx(
              'min-w-0 truncate py-[6px] pl-3 pr-1 text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              s.id === currentId ? 'font-semibold text-fg' : 'text-muted group-hover:text-fg'
            )}
          >
            {s.name}
          </button>
          <button
            type="button"
            aria-label={`Close ${s.name}`}
            title={`Close ${s.name} (its data is kept)`}
            data-testid={`session-tab-close-${s.id}`}
            onClick={() =>
              window.electron.ipcRenderer
                .invoke(IPC_MAIN_CHANNELS.SESSION_CLOSE_TAB, s.id)
                .then(refresh)
                .catch(() => {})
            }
            className="mr-1 flex h-[18px] w-[18px] items-center justify-center rounded text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <Icon icon="lucide:x" fontSize={12} />
          </button>
        </div>
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
