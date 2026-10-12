import {useSyncExternalStore} from 'react';

/** Whether the terminal panel is open: the toolbar button and the panel share it. */
let open = false;
const listeners = new Set<() => void>();
export const setTerminalOpen = (value: boolean) => {
  open = value;
  listeners.forEach((l) => l());
};
export const useTerminalOpen = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open
  );

export type DockView = 'terminal' | 'ports' | 'tunnels' | 'environment';
let view: DockView = 'terminal';
const viewListeners = new Set<() => void>();
export const setDockView = (value: DockView) => {
  view = value;
  viewListeners.forEach((l) => l());
};
export const useDockView = () =>
  useSyncExternalStore(
    (cb) => {
      viewListeners.add(cb);
      return () => viewListeners.delete(cb);
    },
    () => view
  );
