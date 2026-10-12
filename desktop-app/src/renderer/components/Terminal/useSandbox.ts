import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {SandboxState} from 'common/sandbox';
import {useCallback, useEffect, useState} from 'react';

const clean = (e: Error) =>
  e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** This Session's Sandbox: its settings and phase, kept live from the main process. */
export const useSandbox = () => {
  const [state, setState] = useState<SandboxState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    window.electron.ipcRenderer
      .invoke<unknown, SandboxState>(IPC_MAIN_CHANNELS.SANDBOX_STATE)
      .then((s) => {
        if (alive) setState(s);
        return s;
      })
      .catch((e: Error) => alive && setError(clean(e)));
    const off = window.electron.ipcRenderer.on<SandboxState>(
      IPC_MAIN_CHANNELS.SANDBOX_EVENT,
      (s) => s && setState(s)
    );
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const act = useCallback(async (action: string, arg?: string) => {
    setError('');
    try {
      setState(
        await window.electron.ipcRenderer.invoke<unknown, SandboxState>(
          IPC_MAIN_CHANNELS.SANDBOX_ACTION,
          action,
          arg
        )
      );
    } catch (e) {
      setError(clean(e as Error));
    }
  }, []);

  const set = useCallback(async (patch: Record<string, unknown>) => {
    setError('');
    try {
      setState(
        await window.electron.ipcRenderer.invoke<unknown, SandboxState>(
          IPC_MAIN_CHANNELS.SANDBOX_SET,
          patch
        )
      );
    } catch (e) {
      setError(clean(e as Error));
    }
  }, []);

  const pickFolder = useCallback(async () => {
    setError('');
    try {
      const folder = await window.electron.ipcRenderer.invoke<unknown, string | null>(
        IPC_MAIN_CHANNELS.SANDBOX_PICK_FOLDER
      );
      if (folder) await set({folder});
    } catch (e) {
      setError(clean(e as Error));
    }
  }, [set]);

  return {state, error, act, set, pickFolder};
};
