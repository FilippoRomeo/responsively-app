import net from 'net';
import {HostMessage, HostRequest, LineReader} from '../../common/terminal';

export interface HostEndpoint {
  port: number;
  token: string;
}

/**
 * One authenticated connection to the terminal host. Requests that need an
 * answer get one by reqId; everything else the host pushes goes to `onMessage`.
 */
export class HostConnection {
  private socket: net.Socket | null = null;
  private nextId = 1;
  private waiting = new Map<
    number,
    {resolve: (m: HostMessage) => void; reject: (e: Error) => void}
  >();
  closed = false;

  constructor(
    private readonly onMessage: (m: HostMessage) => void,
    private readonly onClose: () => void
  ) {}

  async open(endpoint: HostEndpoint) {
    const socket = net.connect(endpoint.port, '127.0.0.1');
    socket.setEncoding('utf8');
    const reader = new LineReader((line) => {
      let m: HostMessage;
      try {
        m = JSON.parse(line) as HostMessage;
      } catch {
        return;
      }
      const w = m.reqId === undefined ? undefined : this.waiting.get(m.reqId);
      if (w && 'reqId' in m && m.reqId !== undefined) {
        this.waiting.delete(m.reqId);
        if (m.type === 'error') w.reject(new Error(m.message));
        else w.resolve(m);
      } else this.onMessage(m);
    });
    socket.on('data', (chunk) => {
      try {
        reader.push(String(chunk));
      } catch {
        socket.destroy();
      }
    });
    socket.on('close', () => {
      this.closed = true;
      this.waiting.forEach((w) => w.reject(new Error('The terminal service closed.')));
      this.waiting.clear();
      this.onClose();
    });
    socket.on('error', () => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    this.socket = socket;
    await this.request({op: 'auth', token: endpoint.token});
  }

  request(req: HostRequest, timeoutMs = 10_000): Promise<HostMessage> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('The terminal service is not connected.'));
        return;
      }
      const reqId = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        this.waiting.delete(reqId);
        reject(new Error('The terminal service did not answer.'));
      }, timeoutMs);
      this.waiting.set(reqId, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.socket.write(`${JSON.stringify({...req, reqId})}\n`);
    });
  }

  /** Fire and forget (keystrokes, resizes). */
  post(req: HostRequest) {
    if (this.socket && !this.socket.destroyed) this.socket.write(`${JSON.stringify(req)}\n`);
  }

  close() {
    this.socket?.destroy();
  }
}

/** One request, one answer, connection closed: for the controller's own housekeeping. */
export const hostCall = async (endpoint: HostEndpoint, req: HostRequest) => {
  const c = new HostConnection(
    () => {},
    () => {}
  );
  try {
    await c.open(endpoint);
    return await c.request(req);
  } finally {
    c.close();
  }
};
