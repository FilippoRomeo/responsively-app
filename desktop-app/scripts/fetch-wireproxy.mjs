// Fetches wireproxy (userspace WireGuard to SOCKS5, ISC licence) into assets/bin,
// pinned to one release and checked against its SHA-256 before it is used.
// https://github.com/windtf/wireproxy
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const VERSION = 'v1.1.3';
const ASSET = 'wireproxy_darwin_all.tar.gz'; // universal: arm64 and x86_64
const SHA256 = '7d55581d0310afe6b882717e6e6d5abf86cad05b9f5de63d0bb5133ba9da0cee';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'bin');
const target = path.join(bin, 'wireproxy');
const marker = path.join(bin, 'wireproxy.sha256');

if (process.platform !== 'darwin') {
  console.log('[wireproxy] skipped: the WireGuard proxy is macOS only');
  process.exit(0);
}
if (
  fs.existsSync(target) &&
  fs.existsSync(marker) &&
  fs.readFileSync(marker, 'utf8').trim() === SHA256
) {
  console.log(`[wireproxy] ${VERSION} already in assets/bin`);
  process.exit(0);
}

const url = `https://github.com/windtf/wireproxy/releases/download/${VERSION}/${ASSET}`;
console.log(`[wireproxy] downloading ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`wireproxy download failed: HTTP ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
const got = createHash('sha256').update(data).digest('hex');
if (got !== SHA256) throw new Error(`wireproxy checksum mismatch: expected ${SHA256}, got ${got}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wireproxy-'));
try {
  const archive = path.join(dir, ASSET);
  fs.writeFileSync(archive, data);
  execFileSync('tar', ['-xzf', archive, '-C', dir, 'wireproxy']);
  fs.mkdirSync(bin, {recursive: true});
  fs.copyFileSync(path.join(dir, 'wireproxy'), target);
  fs.chmodSync(target, 0o755);
  fs.writeFileSync(marker, `${SHA256}\n`);
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
console.log(`[wireproxy] ${VERSION} ready`);
