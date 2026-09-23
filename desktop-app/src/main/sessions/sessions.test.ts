// @vitest-environment node
import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import {SessionRegistry, requestSchema} from './registry';
import {PortLeases, serve, call, secret} from '../../common/session-rpc';
import {stopAllSessions} from '../../common/session-controller';
import {SessionInfo, SessionRequest} from '../../common/sessions';

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'responsively-sessions-unit-'));
describe('persistent session boundaries', () => {
  it('keeps UUID identity through rename and reload, and rejects duplicate names', () => {
    const dir = root();
    const registry = new SessionRegistry(dir);
    const a = registry.create('Project');
    expect(() => registry.create('Project')).toThrow('already exists');
    const b = registry.create('Other project');
    expect(a.id).not.toBe(b.id);
    expect(() => registry.update(b.id, {name: 'Project'})).toThrow('already exists');
    registry.update(a.id, {name: 'Renamed', lastUrl: 'http://localhost:3020'});
    const reload = new SessionRegistry(dir);
    expect(reload.get(a.id)).toMatchObject({
      id: a.id,
      name: 'Renamed',
      lastUrl: 'http://localhost:3020',
    });
    expect(reload.dataDir(a.id)).toBe(path.join(dir, 'profiles', a.id));
    expect(() => reload.dataDir('../../outside')).toThrow();
    expect(() => reload.create('  ')).toThrow();
    expect(() =>
      requestSchema.parse({operation: 'create', name: 'x', userDataDir: '/tmp/outside'})
    ).toThrow();
  });
  it('fails closed on corruption and refuses symlinked profile paths', () => {
    const dir = root();
    const registry = new SessionRegistry(dir);
    const a = registry.create('A');
    fs.mkdirSync(path.join(dir, 'profiles'));
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'profiles', a.id));
    expect(() => registry.dataDir(a.id)).toThrow(/symbolic/);
    fs.writeFileSync(path.join(dir, 'sessions-registry.json'), '{broken');
    expect(() => new SessionRegistry(dir)).toThrow();
    expect(fs.readFileSync(path.join(dir, 'sessions-registry.json'), 'utf8')).toBe('{broken');
  });
  it('reserves unique loopback ports for concurrent starts and excludes occupied listeners', async () => {
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const leases = new PortLeases();
    const reservations = await Promise.all(Array.from({length: 12}, () => leases.reserve()));
    expect(new Set(reservations.map((r) => r.port)).size).toBe(12);
    expect(reservations.map((r) => r.port)).not.toContain(
      (occupied.address() as net.AddressInfo).port
    );
    await Promise.all(
      reservations.map(async (r) => {
        await r.handoff();
        leases.release(r.port);
      })
    );
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  });
  it('requires a capability for private lifecycle control', async () => {
    const {server, endpoint} = await serve(secret(), async (body) => body);
    try {
      expect(await call(endpoint, {operation: 'status'})).toEqual({operation: 'status'});
      await expect(call({...endpoint, token: 'wrong'}, {operation: 'stop'})).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('quit stops every Session or reports what is left', () => {
  const session = (id: string, status: SessionInfo['status']): SessionInfo => ({
    id,
    name: `Project ${id}`,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    status,
  });
  it('succeeds only when no runtime lease remains', async () => {
    const running = new Set(['a', 'b']);
    const request = async (value: SessionRequest) => {
      if (value.operation === 'list') return [session('a', 'running'), session('b', 'error')];
      running.delete(value.id!);
      return session(value.id!, 'stopped');
    };
    expect(await stopAllSessions(request, () => [...running], 1000)).toEqual([]);
  });
  it('reports a Session whose stop failed and whose lease remains', async () => {
    const request = async (value: SessionRequest) => {
      if (value.operation === 'list') return [session('a', 'error')];
      throw new Error('Session did not stop; its data has been preserved');
    };
    expect(await stopAllSessions(request, () => ['a'], 1000)).toEqual([
      {id: 'a', name: 'Project a'},
    ]);
  });
  it('returns after the cap when the controller never answers', async () => {
    const request = async (value: SessionRequest) =>
      value.operation === 'list' ? [session('a', 'running')] : new Promise<SessionInfo>(() => {});
    const started = Date.now();
    expect(await stopAllSessions(request, () => ['a'], 50)).toEqual([{id: 'a', name: 'Project a'}]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
