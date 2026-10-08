import {useSyncExternalStore} from 'react';

/** Whether the probe panel is open: the toolbar button and the panel share it. */
let open = false;
const listeners = new Set<() => void>();
export const setProbeOpen = (value: boolean) => {
  open = value;
  listeners.forEach((l) => l());
};
export const useProbeOpen = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open
  );
