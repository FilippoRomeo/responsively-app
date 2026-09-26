// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({app: {getPath: () => os.tmpdir()}, shell: {trashItem: vi.fn()}}));
import {ATTENTION_INTERVAL_MS, SessionManager, runtimeFile} from './service';
import {atomicWrite, requestSchema} from './registry';
import {serve, secret} from '../../common/session-rpc';
import {SessionInfo} from '../../common/sessions';

let root: string;
const servers: Array<{close: () => void}> = [];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-attention-test-'));
  process.env.RESPONSIVELY_SESSIONS_ROOT = root;
});
afterEach(() => {
  servers.splice(0).forEach((server) => server.close());
  vi.restoreAllMocks();
});

const create = async (m: SessionManager, name: string) =>
  (await m.request({operation: 'create', name, open: false})) as SessionInfo;

const lease = (m: SessionManager, id: string, pid: number) =>
  atomicWrite(runtimeFile(id), {
    id,
    pid,
    port: 0,
    token: 'not-a-runtime',
    userDataDir: m.registry.dataDir(id),
    mcpPort: 20001,
    browserSyncPort: 20002,
    startedAt: new Date().toISOString(),
  });

/** A stand-in shell endpoint that records what the controller forwards. */
const fakeShell = async () => {
  const received: unknown[] = [];
  const {server, endpoint} = await serve(secret(), async (body) => {
    received.push(body);
    return {userDataDir: '/tmp/shell'};
  });
  servers.push(server);
  atomicWrite(path.join(root, 'shell.json'), endpoint);
  return received;
};

describe('who stopped a Session', () => {
  it('records and persists a crash when a runtime vanishes without a stop', async () => {
    const m = new SessionManager();
    const s = await create(m, 'Crashy');
    const {pid} = spawnSync(process.execPath, ['-e', '']);
    lease(m, s.id, pid!);
    const info = await m.inspect(s.id);
    expect(info.status).toBe('error');
    expect(info.lastStop?.by).toBe('crash');
    expect(new SessionManager().registry.get(s.id).lastStop?.by).toBe('crash');
  });

  it('accepts only real stop origins; a crash cannot be claimed', () => {
    const id = '8b6f2f0e-3c4d-4e5f-9a1b-2c3d4e5f6a7b';
    for (const source of ['user', 'window', 'quit', 'agent'])
      expect(() => requestSchema.parse({operation: 'stop', id, source})).not.toThrow();
    expect(() => requestSchema.parse({operation: 'stop', id, source: 'crash'})).toThrow();
    expect(() => requestSchema.parse({operation: 'stop', id, source: 'admin'})).toThrow();
  });
});

describe('attention', () => {
  it('forwards a stopped Session to the shell at most once per interval', async () => {
    const received = await fakeShell();
    const m = new SessionManager();
    const s = await create(m, 'Idle');
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    await m.request({operation: 'attention', id: s.id});
    await m.request({operation: 'attention', id: s.id});
    expect(received).toEqual([{operation: 'attention', id: s.id}]);

    now += ATTENTION_INTERVAL_MS;
    await m.request({operation: 'attention', id: s.id});
    expect(received).toHaveLength(2);
  });

  it('rate-limits each Session separately', async () => {
    const received = await fakeShell();
    const m = new SessionManager();
    const a = await create(m, 'A');
    const b = await create(m, 'B');
    await m.request({operation: 'attention', id: a.id});
    await m.request({operation: 'attention', id: b.id});
    expect(received).toHaveLength(2);
  });

  it('still answers when no shell is running', async () => {
    const m = new SessionManager();
    const s = await create(m, 'Agent only');
    await expect(m.request({operation: 'attention', id: s.id})).resolves.toMatchObject({
      status: 'stopped',
    });
  });
});

describe('force quit', () => {
  it('requires explicit confirmation', async () => {
    const m = new SessionManager();
    const s = await create(m, 'Unconfirmed');
    await expect(m.request({operation: 'force-stop', id: s.id})).rejects.toThrow(/confirmation/);
  });

  it('refuses a Session that is not hung', async () => {
    const m = new SessionManager();
    const s = await create(m, 'Stopped');
    await expect(m.request({operation: 'force-stop', id: s.id, confirmed: true})).rejects.toThrow(
      /alive but not responding/
    );
  });

  it('never signals a live process it cannot prove is the runtime', async () => {
    const kill = vi.spyOn(process, 'kill');
    const m = new SessionManager();
    const s = await create(m, 'Unproven');
    // This test's own live PID, behind a lease with no authenticated endpoint: hung.
    lease(m, s.id, process.pid);
    expect((await m.inspect(s.id)).hung).toBe(true);
    await expect(m.request({operation: 'force-stop', id: s.id, confirmed: true})).rejects.toThrow(
      /Refusing to force quit.*No process was signalled/
    );
    expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]);
    expect(fs.existsSync(runtimeFile(s.id))).toBe(true);
  });
});
