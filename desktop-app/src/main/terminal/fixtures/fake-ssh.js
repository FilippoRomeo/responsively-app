#!/usr/bin/env node
// A stand-in for ssh in tests: behaves by the host name (the last argument).
const net = require('net');
const args = process.argv.slice(2);
const host = args[args.length - 1];
const spec = args[args.indexOf('-L') + 1] || '';
const port = Number(spec.split(':')[1]);
if (host === 'auth-host') {
  console.error(`${host}: Permission denied (publickey).`);
  process.exit(255);
}
if (host === 'dead-host') {
  console.error('ssh: connect to host dead-host port 22: Operation timed out');
  process.exit(255);
}
// A probe that connects and hangs up must not take the stand-in down.
const server = net.createServer((s) => {
  s.on('error', () => {});
  s.end('tunnel ok\n');
});
server.on('error', (e) => {
  console.error(
    `bind [127.0.0.1]:${port}: ${e.code === 'EADDRINUSE' ? 'Address already in use' : e.message}`
  );
  process.exit(255);
});
server.listen(port, '127.0.0.1', () => {
  if (host === 'drop-host') setTimeout(() => process.exit(255), 1500);
});
process.on('SIGTERM', () => process.exit(0));
