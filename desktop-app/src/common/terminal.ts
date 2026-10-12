/**
 * Local terminals: a real PTY per tab, owned by a host process so a tab outlives
 * its panel and its window. The host speaks newline-delimited JSON over loopback TCP.
 */
export const SCROLLBACK_BYTES = 200_000;
export const MAX_TERMINALS_PER_SESSION = 8;
export const MAX_LINE_BYTES = 256_000;

export interface TerminalInfo {
  id: string;
  session: string;
  title: string;
  cwd: string;
  /** running until the shell ends; the tab and its scrollback stay until closed */
  state: 'running' | 'exited';
  exitCode?: number;
  cols: number;
  rows: number;
}

/** Client → host. The first message of a connection must be {op: 'auth'}. */
export type HostRequest = (
  | {op: 'auth'; token: string}
  | {op: 'list'; session: string}
  | {op: 'create'; session: string; cwd?: string; cols: number; rows: number}
  | {op: 'attach'; id: string}
  | {op: 'detach'; id: string}
  | {op: 'input'; id: string; data: string}
  | {op: 'resize'; id: string; cols: number; rows: number}
  | {op: 'close'; id: string}
  | {op: 'kill-session'; session: string}
) & {reqId?: number};

/** Host → client. `reqId` echoes a request that asked for an answer. */
export type HostMessage = (
  | {type: 'ok'; reqId?: number}
  | {type: 'error'; message: string; reqId?: number}
  | {type: 'list'; terminals: TerminalInfo[]; reqId?: number}
  | {type: 'created'; terminal: TerminalInfo; reqId?: number}
  /** Sent once on attach: what the terminal has printed so far (the latest SCROLLBACK_BYTES). */
  | {type: 'snapshot'; id: string; data: string; terminal: TerminalInfo}
  | {type: 'data'; id: string; data: string}
  | {type: 'exit'; id: string; exitCode: number}
  | {type: 'closed'; id: string}
) & {reqId?: number};

/** The last `limit` characters of everything written to it. */
export class Scrollback {
  private chunks: string[] = [];
  private size = 0;
  constructor(private readonly limit = SCROLLBACK_BYTES) {}
  push(text: string) {
    this.chunks.push(text);
    this.size += text.length;
    while (this.size - this.chunks[0].length >= this.limit && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length;
    }
  }
  text(): string {
    const all = this.chunks.join('');
    return all.length > this.limit ? all.slice(all.length - this.limit) : all;
  }
}

/** Splits a byte stream into lines, refusing a line that grows past `max`. */
export class LineReader {
  private buffer = '';
  constructor(
    private readonly onLine: (line: string) => void,
    private readonly max = MAX_LINE_BYTES
  ) {}
  push(chunk: string) {
    this.buffer += chunk;
    let i = this.buffer.indexOf('\n');
    while (i >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      if (line.length > 0) this.onLine(line);
      i = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.max) throw new Error('Message too large');
  }
}

export const clampSize = (cols: unknown, rows: unknown) => ({
  cols: Math.min(500, Math.max(10, Math.floor(Number(cols)) || 80)),
  rows: Math.min(200, Math.max(3, Math.floor(Number(rows)) || 24)),
});
