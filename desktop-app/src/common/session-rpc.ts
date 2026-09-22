import http from 'http';
import {randomBytes} from 'crypto';
import net from 'net';

export interface Endpoint {
  port: number;
  token: string;
}
export const secret = () => randomBytes(32).toString('hex');
export const call = <T>(endpoint: Endpoint, payload: unknown, timeout = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: endpoint.port,
        method: 'POST',
        path: '/',
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 2_000_000) req.destroy(new Error('Response too large'));
        });
        res.on('end', () => {
          try {
            const value = JSON.parse(data);
            if (res.statusCode !== 200) reject(new Error(value.error ?? 'Session request failed'));
            else resolve(value);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(timeout, () => req.destroy(new Error('Session request timed out')));
    req.on('error', reject);
    req.end(body);
  });
export const serve = async (token: string, handler: (body: unknown) => Promise<unknown>) => {
  const server = http.createServer(async (req, res) => {
    if (
      req.method !== 'POST' ||
      req.headers.authorization !== `Bearer ${token}` ||
      req.headers.origin
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 32768) throw new Error('Request too large');
      }
      const result = await handler(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: error instanceof Error ? error.message : 'Invalid request'}));
    }
  });
  server.requestTimeout = 90_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {server, endpoint: {port: (server.address() as net.AddressInfo).port, token}};
};

/** Reserve real loopback sockets until handoff, and retain logical leases until stop. */
export class PortLeases {
  private used = new Set<number>();
  async reserve() {
    for (let i = 0; i < 100; i += 1) {
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const port = (server.address() as net.AddressInfo).port;
      if (this.used.has(port)) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        continue;
      }
      this.used.add(port);
      return {port, handoff: () => new Promise<void>((resolve) => server.close(() => resolve()))};
    }
    throw new Error('No session ports available');
  }
  release(port: number) {
    this.used.delete(port);
  }
  adopt(port: number) {
    this.used.add(port);
  }
}
