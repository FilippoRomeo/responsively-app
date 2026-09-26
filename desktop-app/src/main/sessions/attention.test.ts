// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {spawn, spawnSync} from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({app: {getPath: () => os.tmpdir()}, shell: {trashItem: vi.fn()}}));
import {ATTENTION_INTERVAL_MS, SessionManager, runtimeFile} from './service';
import {atomicWrite, requestSchema} from './registry';
import {serve, secret} from '../../common/session-rpc';
import log from '../logging';
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

  /** A runtime endpoint that accepts, then drops the connection once the caller has moved on. */
  const vanishing = async (afterMs: number) => {
    const server = net.createServer((socket) => {
      setTimeout(() => socket.destroy(), afterMs);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push(server);
    return (server.address() as net.AddressInfo).port;
  };
  const deadLease = (m: SessionManager, id: string, port: number) => {
    const {pid} = spawnSync(process.execPath, ['-e', '']);
    atomicWrite(runtimeFile(id), {
      id,
      pid,
      port,
      token: 'gone',
      userDataDir: m.registry.dataDir(id),
      mcpPort: 20001,
      browserSyncPort: 20002,
      startedAt: new Date().toISOString(),
    });
  };
  const soon = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

  it('keeps the recorded stop when the exit was handled during a slow status check', async () => {
    const m = new SessionManager();
    const s = await create(m, 'Handled');
    deadLease(m, s.id, await vanishing(400));
    const checking = m.inspect(s.id);
    await soon();
    // Meanwhile a stop (or force quit) saw the exit, removed the lease and recorded itself.
    fs.unlinkSync(runtimeFile(s.id));
    m.registry.update(s.id, {lastStop: {by: 'user', at: new Date().toISOString()}});
    await checking;
    expect(new SessionManager().registry.get(s.id).lastStop?.by).toBe('user');
    expect((await m.inspect(s.id)).status).toBe('stopped');
  });

  it('records no crash when an operation began while the status check was in flight', async () => {
    const m = new SessionManager();
    const s = await create(m, 'Busy');
    deadLease(m, s.id, await vanishing(400));
    const checking = m.inspect(s.id);
    await soon();
    // A stop or force quit marks the Session busy before it signals the process.
    (m as unknown as {pending: Map<string, string>}).pending.set(s.id, 'stopping');
    await checking;
    expect(m.registry.get(s.id).lastStop).toBeUndefined();
  });

  it('accepts only real stop origins; a crash cannot be claimed', () => {
    const id = '8b6f2f0e-3c4d-4e5f-9a1b-2c3d4e5f6a7b';
    for (const source of ['user', 'window', 'quit', 'agent'])
      expect(() => requestSchema.parse({operation: 'stop', id, source})).not.toThrow();
    expect(() => requestSchema.parse({operation: 'stop', id, source: 'crash'})).toThrow();
    expect(() => requestSchema.parse({operation: 'stop', id, source: 'admin'})).toThrow();
  });
});

describe('lifecycle log', () => {
  it('writes one line per action with the Session, who asked and the outcome', async () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => {});
    const m = new SessionManager();
    const s = await create(m, 'Logged');
    await m.request({operation: 'rename', id: s.id, name: 'Logged 2', source: 'user'});
    await m.request({operation: 'delete', id: s.id, confirmed: true, source: 'user'});
    await expect(m.request({operation: 'focus', id: s.id, source: 'agent'})).rejects.toThrow();
    const lines = info.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([
      `[sessions] create ${s.id} "Logged" by unspecified: created`,
      `[sessions] rename ${s.id} "Logged 2" by user: stopped`,
      `[sessions] delete ${s.id} "Logged 2" by user: deleted; its profile, if any, moved to the Trash`,
      `[sessions] focus ${s.id} by agent: failed: Session not found`,
    ]);
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

  // The process proof reads macOS ps; elsewhere force quit is always refused.
  it.runIf(process.platform === 'darwin')(
    'is not recorded as a crash by a status check that overlaps the force quit',
    async () => {
      const m = new SessionManager();
      const s = await create(m, 'Frozen');
      // Like Electron, it handles SIGTERM, so while paused only SIGKILL ends it.
      const child = spawn(
        process.execPath,
        ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1e9); console.log("ready")'],
        {stdio: ['ignore', 'pipe', 'ignore']}
      );
      await new Promise((resolve) => {
        child.stdout!.once('data', resolve);
      });
      process.kill(child.pid!, 'SIGSTOP');
      // An endpoint that accepts and never answers, like a frozen runtime.
      const frozen = net.createServer(() => {});
      await new Promise<void>((resolve) => {
        frozen.listen(0, '127.0.0.1', () => resolve());
      });
      servers.push(frozen);
      atomicWrite(runtimeFile(s.id), {
        id: s.id,
        pid: child.pid,
        port: (frozen.address() as net.AddressInfo).port,
        token: 'frozen',
        userDataDir: m.registry.dataDir(s.id),
        mcpPort: 20001,
        browserSyncPort: 20002,
        startedAt: new Date().toISOString(),
      });
      try {
        const forcing = m.request({operation: 'force-stop', id: s.id, confirmed: true});
        // In flight across the kill: ~1.5 s first inspect + 5 s SIGTERM grace, 1.5 s status timeout.
        await new Promise((resolve) => {
          setTimeout(resolve, 5500);
        });
        const overlapping = m.inspect(s.id);
        await expect(forcing).resolves.toMatchObject({status: 'stopped'});
        await overlapping;
        expect(new SessionManager().registry.get(s.id).lastStop?.by).toBe('user');
        expect((await m.inspect(s.id)).status).toBe('stopped');
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    },
    20_000
  );
});
