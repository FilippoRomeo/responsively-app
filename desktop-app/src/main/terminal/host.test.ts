// @vitest-environment node
import net from 'net';
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
});
