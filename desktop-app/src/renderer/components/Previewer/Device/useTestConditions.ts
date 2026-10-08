import {IPC_MAIN_CHANNELS} from 'common/constants';
import {RefObject, useEffect, useState} from 'react';

/**
 * The test conditions on one preview ("4G · CPU ×4"), set by an agent or by a
 * run in progress, and whether a run is in progress (then they cannot be cleared).
 */
const useTestConditions = (
  ref: RefObject<Electron.WebviewTag | null>,
  webviewReady: boolean
): {label: string | null; clear: () => void; running: boolean} => {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const offConditions = window.electron.ipcRenderer.on<Record<string, string>>(
      IPC_MAIN_CHANNELS.TEST_CONDITIONS,
      (value) => setLabels(value ?? {})
    );
    const offRun = window.electron.ipcRenderer.on<{running: boolean}>(
      IPC_MAIN_CHANNELS.TEST_RUN_STATE,
      (value) => setRunning(Boolean(value?.running))
    );
    return () => {
      offConditions?.();
      offRun?.();
    };
  }, []);
  let id: number | undefined;
  try {
    id = webviewReady ? ref.current?.getWebContentsId() : undefined;
  } catch {
    id = undefined;
  }
  return {
    label: id === undefined ? null : (labels[String(id)] ?? null),
    clear: () => {
      if (id !== undefined)
        window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.TEST_CONDITIONS_CLEAR, id);
    },
    running,
  };
};

export default useTestConditions;
