// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const electronApp = vi.hoisted(() => ({
  getPath: () => '/tmp',
  on: vi.fn(),
  quit: vi.fn(),
}));
vi.mock('electron', () => ({app: electronApp, BrowserWindow: vi.fn(), shell: {}}));

const {createQuitGate} = await import('./window-lifecycle');
const {requestShellQuit, startShellOwner} = await import('./service');
const {call} = await import('../../common/session-rpc');

describe('⌘Q in a Session window asks twice', () => {
  it('arms on the first press and quits only on a second press in time', () => {
    let t = 1000;
    const gate = createQuitGate(2500, () => t);
    expect(gate.press()).toBe('arm');
    t += 2000;
    expect(gate.press()).toBe('quit');
    t += 100;
    expect(gate.press()).toBe('arm');
    t += 3000;
    expect(gate.press()).toBe('arm');
  });
});

describe('the shell quits the whole app on an authenticated request', () => {
  beforeEach(() => {
    process.env.RESPONSIVELY_SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-quit-'));
    electronApp.quit.mockClear();
  });
  it('reports no shell when none is running', async () => {
    expect(await requestShellQuit()).toBe(false);
  });
  it('answers status without quitting, rejects unknown operations, and quits on request', async () => {
    await startShellOwner(vi.fn());
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(process.env.RESPONSIVELY_SESSIONS_ROOT!, 'shell.json'), 'utf8')
    );
    await call(endpoint, {operation: 'status'});
    await expect(call(endpoint, {operation: 'delete-everything'})).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(electronApp.quit).not.toHaveBeenCalled();
    expect(await requestShellQuit()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(electronApp.quit).toHaveBeenCalledTimes(1);
  });
});
