// @vitest-environment node
import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import {SessionRegistry, requestSchema} from './registry';
import {PortLeases, serve, call, secret} from '../../common/session-rpc';

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
