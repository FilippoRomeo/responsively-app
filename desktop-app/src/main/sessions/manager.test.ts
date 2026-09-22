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
  it('requires deletion confirmation and validates identity at the boundary', async () => {
    const m = new SessionManager();
    const s = (await m.request({operation: 'create', name: 'A', open: false})) as SessionInfo;
    await expect(m.request({operation: 'delete', id: s.id})).rejects.toThrow(/confirmation/);
    await expect(m.request({operation: 'get', id: '../../other'})).rejects.toThrow();
    await expect(m.request({operation: 'create', name: 'B', port: 12731})).rejects.toThrow();
    expect(m.registry.list()).toHaveLength(1);
  });
});
