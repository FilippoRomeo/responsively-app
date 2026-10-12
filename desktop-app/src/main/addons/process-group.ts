import type {ChildProcess} from 'child_process';

/**
 * Ends a command and everything it started. A shell running `npm start` has
 * children (node, a dev server); killing only the shell leaves them holding the port.
 * The command must have been spawned `detached` so it leads its own group.
 */
export const killGroup = (child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') => {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
};
