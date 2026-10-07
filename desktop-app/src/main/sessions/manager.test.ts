// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
vi.mock('electron', () => ({app: {getPath: () => os.tmpdir()}, shell: {trashItem: vi.fn()}}));
import {spawn} from 'child_process';
import {SessionManager, STOP_QUIT_MS, runtimeFile} from './service';
import {serve} from '../../common/session-rpc';
import {atomicWrite} from './registry';
import {SessionInfo} from '../../common/sessions';
import {shell} from 'electron';

describe('SessionManager safety', () => {
  beforeEach(() => {
    process.env.RESPONSIVELY_SESSIONS_ROOT = fs.mkdtempSync(
      path.join(os.tmpdir(), 'session-manager-test-')
    );
  });
  it('changes agent access only on a running Session and needs an explicit value', async () => {
    const m = new SessionManager();
    const s = (await m.request({operation: 'create', name: 'Agents', open: false})) as SessionInfo;
    await expect(m.request({operation: 'agents', id: s.id, enabled: false})).rejects.toThrow(
      /Open the Session/
    );
    await expect(m.request({operation: 'agents', id: s.id})).rejects.toThrow(/enabled/);
    await expect(m.request({operation: 'agents', id: s.id, enabled: 'no'})).rejects.toThrow();
  });
  it('saves mute with the Session, also while stopped, and survives a registry reload', async () => {
    const m = new SessionManager();
    const s = (await m.request({operation: 'create', name: 'Quiet', open: false})) as SessionInfo;
    expect(s.muted).toBeUndefined();
    const muted = (await m.request({operation: 'mute', id: s.id, muted: true})) as SessionInfo;
    expect(muted).toMatchObject({muted: true, status: 'stopped'});
    expect(new SessionManager().registry.get(s.id).muted).toBe(true);
    await m.request({operation: 'mute', id: s.id, muted: false});
    expect(m.registry.get(s.id).muted).toBe(false);
    await expect(m.request({operation: 'mute', id: s.id})).rejects.toThrow(/muted/);
    await expect(m.request({operation: 'mute', id: s.id, muted: 'yes'})).rejects.toThrow();
  });
  it('never deletes or stops a live PID without an authenticated runtime', async () => {
    const m = new SessionManager();
    const s = (await m.request({
      operation: 'create',
      name: 'Protected',
      open: false,
    })) as SessionInfo;
    atomicWrite(runtimeFile(s.id), {
      id: s.id,
      pid: process.pid,
      port: 0,
      token: 'not-a-runtime',
      userDataDir: m.registry.dataDir(s.id),
      mcpPort: 20001,
      browserSyncPort: 20002,
      startedAt: new Date().toISOString(),
    });
    expect((await m.inspect(s.id)).status).toBe('error');
    await expect(m.request({operation: 'stop', id: s.id})).rejects.toThrow();
    await expect(m.request({operation: 'delete', id: s.id, confirmed: true})).rejects.toThrow(
      /Stop/
    );
    expect(m.registry.get(s.id).name).toBe('Protected');
  });
  it('reports a starting runtime without the not-responding error, but still reports a hang', async () => {
    const m = new SessionManager();
    const s = (await m.request({operation: 'create', name: 'Booting', open: false})) as SessionInfo;
    // The lease is published before the runtime serves it (port 0) while the process is alive.
    atomicWrite(runtimeFile(s.id), {
      id: s.id,
      pid: process.pid,
      port: 0,
      token: 'not-serving-yet',
      userDataDir: m.registry.dataDir(s.id),
      mcpPort: 20001,
      browserSyncPort: 20002,
      startedAt: new Date().toISOString(),
    });
    m['pending'].set(s.id, 'starting');
    const starting = await m.inspect(s.id);
    expect(starting.status).toBe('starting');
    expect(starting.error).toBeUndefined();
    m['pending'].delete(s.id);
    const hung = await m.inspect(s.id);
    expect(hung.status).toBe('error');
    expect(hung.error).toMatch(/not responding/);
  });
  /**
   * A fake runtime: a real endpoint and a real process. On Stop it closes its
   * endpoint (as will-quit does) and its process exits `exitAfterMs` later;
   * `quits: false` ignores Stop.
   */
  const fakeRuntime = async (m: SessionManager, id: string, quits: boolean, exitAfterMs = 0) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
    const lease = {
      id,
      pid: child.pid!,
      token: 'fake-runtime',
      userDataDir: m.registry.dataDir(id),
      mcpPort: null,
      browserSyncPort: 20002,
      startedAt: new Date().toISOString(),
    };
    const {server, endpoint} = await serve(lease.token, async (body) => {
      if ((body as {operation: string}).operation === 'stop' && quits)
        setTimeout(() => {
          server.close();
          server.closeIdleConnections();
          setTimeout(() => child.kill('SIGKILL'), exitAfterMs);
        }, 50);
      return {...lease, ready: true, devices: []};
    });
    atomicWrite(runtimeFile(id), {...lease, ...endpoint});
    return {child, server};
  };

  it('waits for a runtime that is quitting slowly and reports it stopping, not hung', async () => {
    const m = new SessionManager();
    const s = (await m.request({operation: 'create', name: 'Slow', open: false})) as SessionInfo;
    const {child} = await fakeRuntime(m, s.id, true, 2500);
    const statuses = new Set<string>();
    const watch = setInterval(() => {
      m.inspect(s.id)
        .then((info) => statuses.add(info.status))
        .catch(() => {});
    }, 200);
    try {
      const stopped = (await m.request({operation: 'stop', id: s.id})) as SessionInfo;
      expect(stopped.status).toBe('stopped');
      expect(stopped.lastStop?.by).toBe('user');
    } finally {
      clearInterval(watch);
      child.kill('SIGKILL');
    }
    expect(statuses.has('stopping')).toBe(true);
    expect(statuses.has('error')).toBe(false);
  }, 15_000);

  it(
    'fails a stop when the runtime never starts quitting; it is still reported running',
    async () => {
      const m = new SessionManager();
      const s = (await m.request({operation: 'create', name: 'Stuck', open: false})) as SessionInfo;
      const {child, server} = await fakeRuntime(m, s.id, false);
      try {
        await expect(m.request({operation: 'stop', id: s.id})).rejects.toThrow(
          /did not start stopping/
        );
        // Still answering, so it is running, not hung; its data is untouched.
        expect((await m.inspect(s.id)).status).toBe('running');
        expect(fs.existsSync(runtimeFile(s.id))).toBe(true);
      } finally {
        server.close();
        child.kill('SIGKILL');
      }
    },
    STOP_QUIT_MS + 10_000
  );

  it('resets data only for a stopped Session, moving its profile to Trash and keeping it', async () => {
    vi.mocked(shell.trashItem).mockClear();
    const m = new SessionManager();
    const s = (await m.request({
      operation: 'create',
      name: 'Resettable',
      open: false,
    })) as SessionInfo;
    const dir = m.registry.dataDir(s.id);
    fs.mkdirSync(dir, {recursive: true});
    await expect(m.request({operation: 'reset', id: s.id})).rejects.toThrow(/confirmation/);
    // A live, unverified runtime blocks the reset exactly like Delete.
    atomicWrite(runtimeFile(s.id), {
      id: s.id,
      pid: process.pid,
      port: 0,
      token: 'not-a-runtime',
      userDataDir: dir,
      mcpPort: 20001,
      browserSyncPort: 20002,
      startedAt: new Date().toISOString(),
    });
    await expect(m.request({operation: 'reset', id: s.id, confirmed: true})).rejects.toThrow(
      /Stop/
    );
    expect(shell.trashItem).not.toHaveBeenCalled();
    fs.unlinkSync(runtimeFile(s.id));
    const after = (await m.request({operation: 'reset', id: s.id, confirmed: true})) as SessionInfo;
    expect(shell.trashItem).toHaveBeenCalledWith(dir);
    expect(after).toMatchObject({id: s.id, name: 'Resettable', status: 'stopped'});
    expect(m.registry.get(s.id).name).toBe('Resettable');
  });
  it('requires deletion confirmation and validates identity at the boundary', async () => {
    const m = new SessionManager();
    const s = (await m.request({operation: 'create', name: 'A', open: false})) as SessionInfo;
    await expect(m.request({operation: 'delete', id: s.id})).rejects.toThrow(/confirmation/);
    await expect(m.request({operation: 'get', id: '../../other'})).rejects.toThrow();
    await expect(m.request({operation: 'create', name: 'B', port: 12731})).rejects.toThrow();
    expect(m.registry.list()).toHaveLength(1);
  });
});
