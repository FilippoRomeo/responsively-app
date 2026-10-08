import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useEffect, useState} from 'react';

interface RunState {
  running: boolean;
  done: number;
  total: number;
  label: string;
}

/**
 * While a test runs (an agent's run_test) the previews reload and are throttled
 * on purpose: say so, show where it is, and let the user stop it.
 */
const TestRunBar = () => {
  const [state, setState] = useState<RunState | null>(null);
  useEffect(
    () =>
      window.electron.ipcRenderer.on<RunState>(IPC_MAIN_CHANNELS.TEST_RUN_STATE, (value) =>
        setState(value?.running ? value : null)
      ),
    []
  );
  if (!state) return null;
  return (
    <div
      role="status"
      data-testid="test-run-bar"
      className="flex h-9 flex-shrink-0 items-center gap-3 border-b border-accent bg-accent-soft px-[14px] text-[12.5px] text-fg"
    >
      <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      <span className="font-bold">Test running</span>
      <span className="text-muted">
        {Math.min(state.done + 1, state.total)} of {state.total}
        {state.label ? ` · ${state.label}` : ''}. The previews reload and are throttled until it
        ends.
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.TEST_RUN_STOP)}
        className="h-7 rounded-[7px] border border-line px-3 hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        Stop
      </button>
    </div>
  );
};

export default TestRunBar;
