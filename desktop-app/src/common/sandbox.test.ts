import {describe, expect, it} from 'vitest';
import {
  createArgs,
  parseDockerPs,
  DEFAULT_SANDBOX,
  isOurTmux,
  parseColimaList,
  parseSs,
  phaseFromColima,
  profileFor,
  sanitizeSandbox,
  sshConfigFor,
  tmuxNameFor,
  validFolder,
} from './sandbox';

describe('names', () => {
  it('derives a profile from the Session id', () => {
    expect(profileFor('b58329a4-a126-4b23-b019-341c142048b2')).toBe('resp-b58329a4');
    expect(profileFor('')).toBe('resp-main');
    expect(sshConfigFor('resp-ab', '/h/.colima')).toBe(
      '/h/.colima/_lima/colima-resp-ab/ssh.config'
    );
  });
});

describe('createArgs', () => {
  it('lists the folders it shows, never the home folder, and leaves your Docker context alone', () => {
    const args = createArgs('resp-x', {...DEFAULT_SANDBOX, folder: '/Users/me/app'}, '/ex');
    expect(args.filter((a) => a === '--mount')).toHaveLength(2);
    expect(args).toContain('/ex:w');
    expect(args).toContain('/Users/me/app:w');
    expect(args).toContain('--activate=false');
    expect(args).toContain('none'); // the port forwarder and the runtime when Docker is off
    expect(args).not.toContain('--ssh-agent');
    expect(args.join(' ')).not.toMatch(/\/Users\/me:/);
  });
  it('adds Docker and the ssh-agent only when asked', () => {
    const args = createArgs(
      'p',
      {...DEFAULT_SANDBOX, docker: true, sshAgent: true, size: 4},
      '/ex'
    );
    expect(args).toContain('docker');
    expect(args).toContain('--ssh-agent');
    expect(args.slice(args.indexOf('--cpu'), args.indexOf('--cpu') + 4)).toEqual([
      '--cpu',
      '4',
      '--memory',
      '4',
    ]);
  });
});

describe('sanitizeSandbox / validFolder', () => {
  it('drops what is invalid', () => {
    const s = sanitizeSandbox({
      mode: 'sandbox',
      size: 9,
      folder: '/etc',
      docker: 'yes',
      publish: 'auto',
    });
    expect(s).toMatchObject({mode: 'sandbox', size: 2, docker: false, publish: 'auto'});
    expect(s.folder).toBeUndefined();
    expect(validFolder('/Users/me/app')).toBe(true);
    expect(validFolder('relative/dir')).toBe(false);
    expect(validFolder('/')).toBe(false);
    expect(validFolder('/System/Library')).toBe(false);
  });
});

describe('colima output', () => {
  it('reads one JSON object per line', () => {
    const out =
      '{"name":"default","status":"Stopped","cpus":2,"memory":1,"disk":1,"runtime":"docker"}\n{"name":"resp-x","status":"Running","cpus":2,"memory":1,"disk":1,"runtime":"none"}\nINFO noise\n';
    const list = parseColimaList(out);
    expect(list.map((p) => p.name)).toEqual(['default', 'resp-x']);
    expect(phaseFromColima(list[1])).toBe('running');
    expect(phaseFromColima(list[0])).toBe('stopped');
    expect(phaseFromColima(undefined)).toBe('none');
  });
});

describe('tmux and ports', () => {
  it('recognises only its own tmux sessions', () => {
    expect(isOurTmux(tmuxNameFor('0123456789abcdef'))).toBe(true);
    expect(isOurTmux('work')).toBe(false);
    expect(isOurTmux('resp-test')).toBe(false);
  });
  it('lists the user services listening in the guest', () => {
    const ss = [
      'LISTEN 0      5      127.0.0.1:8099  0.0.0.0:*',
      'LISTEN 0      32     192.168.5.1:53  0.0.0.0:*',
      'LISTEN 0      4096   0.0.0.0:22      0.0.0.0:*',
      'LISTEN 0      511    0.0.0.0:3000    0.0.0.0:*',
      'LISTEN 0      511    [::]:3000       [::]:*',
    ].join('\n');
    expect(parseSs(ss)).toEqual([3000, 8099]);
  });
});

describe('parseDockerPs', () => {
  it('reads containers and the ports they publish on the machine', () => {
    const out = [
      'stack-web-1|nginx:alpine|running|0.0.0.0:8088->80/tcp, [::]:8088->80/tcp',
      'stack-cache-1|redis:7-alpine|running|6379/tcp',
      'multi|app:1|running|0.0.0.0:9000-9002->9000-9002/tcp',
      '',
      'broken line',
    ].join('\n');
    const list = parseDockerPs(out);
    expect(list.map((c) => c.name)).toEqual(['stack-web-1', 'stack-cache-1', 'multi']);
    expect(list[0]).toMatchObject({image: 'nginx:alpine', state: 'running', ports: [8088]});
    expect(list[1].ports).toEqual([]);
    expect(list[2].ports).toEqual([9000, 9001, 9002]);
  });
});
