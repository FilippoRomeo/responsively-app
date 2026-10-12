// @vitest-environment node
import {spawn} from 'child_process';
import {describe, expect, it} from 'vitest';
import {killGroup} from './process-group';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('killGroup', () => {
  it('ends the shell and the processes it started', async () => {
    // The shell starts a long sleep and waits on it, like `npm start` with a dev server under it.
    const child = spawn('/bin/sh', ['-c', 'sleep 60 & echo $! ; wait'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const grandchild = await new Promise<number>((resolve) => {
      child.stdout!.once('data', (d) => resolve(Number(String(d).trim())));
    });
    expect(alive(grandchild)).toBe(true);
    killGroup(child);
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    expect(alive(grandchild)).toBe(false);
    expect(alive(child.pid!)).toBe(false);
  });
});
