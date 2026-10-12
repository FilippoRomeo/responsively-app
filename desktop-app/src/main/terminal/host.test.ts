// @vitest-environment node
import net from 'net';
import path from 'path';
import type {TunnelDef} from '../../common/tunnel';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {HostMessage, HostRequest, LineReader} from '../../common/terminal';
import {startTerminalHost} from './host';

const connect = (port: number) =>
  new Promise<{
    socket: net.Socket;
    messages: HostMessage[];
    send: (r: HostRequest) => void;
    until: (pred: (m: HostMessage) => boolean, ms?: number) => Promise<HostMessage>;
  }>((resolve, _reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const messages: HostMessage[] = [];
    const waiters: (() => void)[] = [];
    const reader = new LineReader((line) => {
      messages.push(JSON.parse(line));
      waiters.splice(0).forEach((w) => w());
    });
    socket.setEncoding('utf8');
    socket.on('data', (d) => reader.push(String(d)));
    socket.once('error', _reject);
    socket.once('connect', () =>
      resolve({
        socket,
        messages,
        send: (r) => socket.write(`${JSON.stringify(r)}\n`),
        until: (pred, ms = 8000) =>
          new Promise<HostMessage>((resolve, reject) => {
            const start = Date.now();
            const check = () => {
              const m = messages.find(pred);
              if (m) resolve(m);
              else if (Date.now() - start > ms)
                reject(
                  new Error(`timed out; got ${JSON.stringify(messages.slice(-3)).slice(0, 900)}`)
                );
              else {
                waiters.push(check);
                setTimeout(check, 100);
              }
            };
            check();
          }),
      })
    );
  });

describe('terminal host', () => {
  let host: Awaited<ReturnType<typeof startTerminalHost>>;
  const counts: number[] = [];
  beforeAll(async () => {
    process.env.RESPONSIVELY_SSH = path.join(__dirname, 'fixtures', 'fake-ssh.js');
    host = await startTerminalHost({onCount: (n) => counts.push(n)});
  });
  afterAll(() => host.stop());

  it('refuses a connection without the token', async () => {
    const c = await connect(host.port);
    c.send({op: 'list', session: 's'});
    await new Promise<void>((resolve) => {
      c.socket.once('close', () => resolve());
    });
    expect(c.messages).toEqual([]);
  });

  it('runs a real shell, replays its output to a new connection, and closes it', async () => {
    const a = await connect(host.port);
    a.send({op: 'auth', token: host.token});
    await a.until((m) => m.type === 'ok');
    a.send({op: 'create', session: 'sess', cols: 100, rows: 30, reqId: 7});
    const created = (await a.until((m) => m.type === 'created')) as Extract<
      HostMessage,
      {type: 'created'}
    >;
    expect(created.reqId).toBe(7);
    const id = created.terminal.id;
    a.send({op: 'attach', id});
    await a.until((m) => m.type === 'snapshot');
    a.send({op: 'input', id, data: 'echo MARK_$((6*7))\r'});
    await a.until((m) => m.type === 'data' && m.data.includes('MARK_42'));
    expect(counts.at(-1)).toBe(1);

    // The window closes: the connection drops, the terminal lives.
    a.socket.destroy();
    const b = await connect(host.port);
    b.send({op: 'auth', token: host.token});
    await b.until((m) => m.type === 'ok');
    b.send({op: 'list', session: 'sess'});
    const list = (await b.until((m) => m.type === 'list')) as Extract<HostMessage, {type: 'list'}>;
    expect(list.terminals.map((t) => t.id)).toEqual([id]);
    b.send({op: 'attach', id});
    const snap = (await b.until((m) => m.type === 'snapshot')) as Extract<
      HostMessage,
      {type: 'snapshot'}
    >;
    expect(snap.data).toContain('MARK_42');

    // Another Session sees nothing of it.
    b.send({op: 'list', session: 'other'});
    await b.until(
      (m) => m.type === 'list' && m.terminals.length === 0 && m.reqId === undefined && m !== list
    );

    b.send({op: 'kill-session', session: 'sess'});
    await b.until((m) => m.type === 'closed');
    expect(host.terminalCount()).toBe(0);
    expect(counts.at(-1)).toBe(0);
    b.socket.destroy();
  });

  it('reports a shell that ended and keeps its scrollback until closed', async () => {
    const a = await connect(host.port);
    a.send({op: 'auth', token: host.token});
    await a.until((m) => m.type === 'ok');
    a.send({op: 'create', session: 'x', cols: 80, rows: 24});
    const created = (await a.until((m) => m.type === 'created')) as Extract<
      HostMessage,
      {type: 'created'}
    >;
    a.send({op: 'attach', id: created.terminal.id});
    a.send({op: 'input', id: created.terminal.id, data: 'exit 3\r'});
    const exit = (await a.until((m) => m.type === 'exit')) as Extract<HostMessage, {type: 'exit'}>;
    expect(exit.exitCode).toBe(3);
    a.send({op: 'list', session: 'x'});
    const list = (await a.until((m) => m.type === 'list')) as Extract<HostMessage, {type: 'list'}>;
    expect(list.terminals[0].state).toBe('exited');
    a.send({op: 'close', id: created.terminal.id});
    await a.until((m) => m.type === 'closed');
    a.socket.destroy();
  });

  it('limits terminals per Session', {timeout: 40_000}, async () => {
    const a = await connect(host.port);
    a.send({op: 'auth', token: host.token});
    await a.until((m) => m.type === 'ok');
    for (let i = 0; i < 8; i += 1)
      a.send({op: 'create', session: 'many', cols: 80, rows: 24, reqId: i});
    await a.until((m) => m.type === 'created' && m.reqId === 7, 30_000);
    a.send({op: 'create', session: 'many', cols: 80, rows: 24, reqId: 99});
    const err = (await a.until((m) => m.type === 'error' && m.reqId === 99)) as Extract<
      HostMessage,
      {type: 'error'}
    >;
    expect(err.message).toMatch(/8 terminals/);
    a.send({op: 'kill-session', session: 'many', reqId: 100});
    await a.until((m) => m.type === 'ok' && m.reqId === 100);
    expect(host.terminalCount()).toBe(0);
    a.socket.destroy();
  });

  describe('tunnels and ports', () => {
    const freePort = () =>
      new Promise<number>((resolve) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
          const {port} = server.address() as net.AddressInfo;
          server.close(() => resolve(port));
        });
      });
    const def = (over: Partial<TunnelDef>): TunnelDef => ({
      id: `t-${Math.random().toString(36).slice(2, 8)}`,
      name: 'test',
      host: 'good-host',
      remote: 'localhost:8188',
      localPort: 40000,
      anyPort: false,
      autoStart: false,
      ...over,
    });
    const open = async () => {
      const c = await connect(host.port);
      c.send({op: 'auth', token: host.token});
      await c.until((m) => m.type === 'ok');
      return c;
    };
    const stateOf = (m: HostMessage) => (m.type === 'tunnel' ? m.tunnel : undefined);
    const waitState = (
      c: Awaited<ReturnType<typeof open>>,
      id: string,
      state: string,
      ms = 15_000
    ) =>
      c.until((m) => stateOf(m)?.def.id === id && stateOf(m)?.state === state, ms) as Promise<
        Extract<HostMessage, {type: 'tunnel'}>
      >;

    it('is Connected only once the local port answers, and Stopped when stopped', async () => {
      const c = await open();
      const port = await freePort();
      const d = def({localPort: port});
      c.send({op: 'tunnel-start', session: 'tun', def: d});
      const up = await waitState(c, d.id, 'connected');
      expect(up.tunnel.localPort).toBe(port);
      const reply = await new Promise<string>((resolve) => {
        const s = net.connect(port, '127.0.0.1');
        s.setEncoding('utf8');
        s.on('data', (x) => resolve(String(x)));
      });
      expect(reply).toContain('tunnel ok');
      expect(host.activeCount()).toBeGreaterThanOrEqual(1);
      c.send({op: 'tunnel-stop', id: d.id});
      await waitState(c, d.id, 'stopped');
      c.socket.destroy();
    });

    it('says Authentication required, and does not retry', async () => {
      const c = await open();
      const d = def({host: 'auth-host', localPort: await freePort()});
      c.send({op: 'tunnel-start', session: 'tun', def: d});
      const m = await waitState(c, d.id, 'auth-required');
      expect(m.tunnel.detail).toMatch(/Permission denied/);
      c.send({op: 'tunnel-list', session: 'tun', reqId: 77});
      const list = (await c.until((x) => x.type === 'tunnels' && x.reqId === 77)) as Extract<
        HostMessage,
        {type: 'tunnels'}
      >;
      expect(list.tunnels.find((t) => t.def.id === d.id)?.state).toBe('auth-required');
      c.socket.destroy();
    });

    it('reports a taken port, or moves to a free one when allowed', async () => {
      const taken = net.createServer();
      await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', () => resolve()));
      const busy = (taken.address() as net.AddressInfo).port;
      const c = await open();
      const strict = def({localPort: busy});
      c.send({op: 'tunnel-start', session: 'tun', def: strict});
      await waitState(c, strict.id, 'port-conflict');
      const flexible = def({localPort: busy, anyPort: true});
      c.send({op: 'tunnel-start', session: 'tun', def: flexible});
      const up = await waitState(c, flexible.id, 'connected');
      expect(up.tunnel.localPort).not.toBe(busy);
      c.send({op: 'kill-session', session: 'tun', reqId: 5});
      await c.until((m) => m.type === 'ok' && m.reqId === 5);
      taken.close();
      c.socket.destroy();
    });

    it('reconnects after a connection that dropped', async () => {
      const c = await open();
      const d = def({host: 'drop-host', localPort: await freePort()});
      c.send({op: 'tunnel-start', session: 'tun', def: d});
      await waitState(c, d.id, 'connected');
      const again = await waitState(c, d.id, 'reconnecting');
      expect(again.tunnel.attempts).toBeGreaterThanOrEqual(1);
      c.send({op: 'kill-session', session: 'tun', reqId: 6});
      await c.until((m) => m.type === 'ok' && m.reqId === 6);
      c.socket.destroy();
    });

    it(
      'lists the ports a terminal started, by process, and its tunnels',
      {timeout: 30_000},
      async () => {
        const c = await open();
        const port = await freePort();
        c.send({op: 'create', session: 'ports', cols: 80, rows: 24, reqId: 1});
        const created = (await c.until((m) => m.type === 'created')) as Extract<
          HostMessage,
          {type: 'created'}
        >;
        c.send({op: 'attach', id: created.terminal.id});
        c.send({
          op: 'input',
          id: created.terminal.id,
          data: `/usr/bin/python3 -m http.server ${port} --bind 127.0.0.1 >/dev/null 2>&1 &\r`,
        });
        let found: Extract<HostMessage, {type: 'ports'}> | undefined;
        for (let i = 0; i < 20 && !found; i += 1) {
          await new Promise((resolve) => {
            setTimeout(resolve, 500);
          });
          c.send({op: 'ports', session: 'ports', reqId: 100 + i});
          const m = (await c.until((x) => x.type === 'ports' && x.reqId === 100 + i)) as Extract<
            HostMessage,
            {type: 'ports'}
          >;
          if (m.ports.some((p) => p.port === port)) found = m;
        }
        expect(found?.ports.find((p) => p.port === port)).toMatchObject({source: 'terminal'});
        // Another Session sees none of it.
        c.send({op: 'ports', session: 'elsewhere', reqId: 300});
        const other = (await c.until((x) => x.type === 'ports' && x.reqId === 300)) as Extract<
          HostMessage,
          {type: 'ports'}
        >;
        expect(other.ports.some((p) => p.port === port)).toBe(false);
        c.send({op: 'kill-session', session: 'ports', reqId: 301});
        await c.until((m) => m.type === 'ok' && m.reqId === 301);
        c.socket.destroy();
      }
    );
  });
});
