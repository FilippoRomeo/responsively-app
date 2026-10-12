import {describe, expect, it} from 'vitest';
import {
  backoffSeconds,
  classifyExit,
  parseSshHosts,
  sshArgs,
  validateTunnel,
  type TunnelDef,
} from './tunnel';

const def: TunnelDef = {
  id: 't1',
  name: 'ComfyUI on gpu-box',
  host: 'gpu-box',
  remote: 'localhost:8188',
  localPort: 8188,
  anyPort: true,
  autoStart: false,
};

describe('validateTunnel', () => {
  it('accepts a normal tunnel', () => expect(validateTunnel(def)).toBeNull());
  it('refuses anything that could become an ssh option or a shell word', () => {
    expect(validateTunnel({...def, host: '-oProxyCommand=evil'})).toMatch(/alias/);
    expect(validateTunnel({...def, host: 'a b'})).toMatch(/alias/);
    expect(validateTunnel({...def, remote: 'localhost'})).toMatch(/localhost:8188/);
    expect(validateTunnel({...def, remote: 'x;rm:80'})).toMatch(/localhost:8188/);
    expect(validateTunnel({...def, localPort: 80})).toMatch(/1024/);
    expect(validateTunnel({...def, name: ' '})).toMatch(/name/);
  });
});

describe('sshArgs', () => {
  it('runs in the foreground with fail-fast options and the host after --', () => {
    const args = sshArgs(def, 9000);
    expect(args).toContain('-N');
    expect(args).not.toContain('-f');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('127.0.0.1:9000:localhost:8188');
    expect(args.slice(-2)).toEqual(['--', 'gpu-box']);
  });
});

describe('classifyExit', () => {
  it('reads the usual failures', () => {
    expect(classifyExit(255, 'bind [127.0.0.1]:8188: Address already in use', false).state).toBe(
      'port-conflict'
    );
    expect(classifyExit(255, 'gpu-box: Permission denied (publickey).', false).state).toBe(
      'auth-required'
    );
    expect(classifyExit(255, 'Host key verification failed.', false).state).toBe('auth-required');
    expect(
      classifyExit(255, 'connect to host gpu-box port 22: Operation timed out', false).state
    ).toBe('failed');
    expect(classifyExit(255, 'Connection reset', true).state).toBe('reconnecting');
  });
});

describe('backoffSeconds', () => {
  it('doubles up to a minute', () => {
    expect([1, 2, 3, 4, 8, 20].map(backoffSeconds)).toEqual([1, 2, 4, 8, 60, 60]);
  });
});

describe('parseSshHosts', () => {
  it('lists plain aliases and skips patterns', () => {
    const cfg =
      'Host filippo-vps\n  HostName 1.2.3.4\nHost 100.115.239.95 gpu-box\nHost *\nHost github.com\nHost !bad foo?\n';
    expect(parseSshHosts(cfg)).toEqual(['filippo-vps', '100.115.239.95', 'gpu-box', 'github.com']);
  });
});
