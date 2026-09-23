// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
vi.mock('electron', () => ({app: {getPath: () => os.tmpdir()}, shell: {trashItem: vi.fn()}}));
import {SessionManager, runtimeFile} from './service';
import {atomicWrite} from './registry';
import {SessionInfo} from '../../common/sessions';

describe('SessionManager safety', () => {
  beforeEach(() => {
    process.env.RESPONSIVELY_SESSIONS_ROOT = fs.mkdtempSync(
      path.join(os.tmpdir(), 'session-manager-test-')
    );
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
  it('requires deletion confirmation and validates identity at the boundary', async () => {
    const m = new SessionManager();
    const s = (await m.request({operation: 'create', name: 'A', open: false})) as SessionInfo;
    await expect(m.request({operation: 'delete', id: s.id})).rejects.toThrow(/confirmation/);
    await expect(m.request({operation: 'get', id: '../../other'})).rejects.toThrow();
    await expect(m.request({operation: 'create', name: 'B', port: 12731})).rejects.toThrow();
    expect(m.registry.list()).toHaveLength(1);
  });
});
