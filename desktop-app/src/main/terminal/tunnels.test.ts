// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {descendants, parseLsof} from './tunnels';

describe('parseLsof', () => {
  it('reads pid, command and port from -F output', () => {
    const out = 'p123\ncnode\nn*:5173\nn[::1]:5173\np456\ncpostgres\nn127.0.0.1:5432\n';
    expect(parseLsof(out)).toEqual([
      {pid: 123, command: 'node', port: 5173},
      {pid: 123, command: 'node', port: 5173},
      {pid: 456, command: 'postgres', port: 5432},
    ]);
  });
});

describe('descendants', () => {
  it('collects a shell and everything it started, not its siblings', () => {
    const ps = ' 10 1\n 11 10\n 12 11\n 20 1\n 21 20\n';
    expect([...descendants(ps, [10])].sort()).toEqual([10, 11, 12]);
  });
});
