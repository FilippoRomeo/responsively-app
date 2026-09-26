// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {parsePs, provesRuntime, readProcess} from './process-proof';

const EXE = '/Users/dev/Applications/ResponsivelyMCP.app/Contents/MacOS/ResponsivelyApp';
const local = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  new Date(y, mo, d, h, mi, s);

describe('parsePs', () => {
  it('reads the local start time and the executable path', () => {
    expect(parsePs(`Sat Sep 26 15:22:08 2026 ${EXE}\n`)).toEqual({
      startedAt: local(2026, 8, 26, 15, 22, 8),
      executable: EXE,
    });
  });

  it('accepts a space-padded single-digit day and paths with spaces', () => {
    const path = '/Applications/My Apps/ResponsivelyMCP.app/Contents/MacOS/ResponsivelyApp';
    expect(parsePs(`Sun Sep  6 09:05:01 2026 ${path}`)).toEqual({
      startedAt: local(2026, 8, 6, 9, 5, 1),
      executable: path,
    });
  });

  it('rejects anything it cannot parse', () => {
    expect(parsePs('')).toBeNull();
    expect(parsePs('garbage')).toBeNull();
    expect(parsePs(`Sat Foo 26 15:22:08 2026 ${EXE}`)).toBeNull();
  });
});

describe('provesRuntime', () => {
  const facts = {startedAt: local(2026, 8, 26, 15, 22, 8), executable: EXE};
  const lease = {startedAt: local(2026, 8, 26, 15, 22, 8).toISOString()};

  it('accepts the process the lease describes', () => {
    expect(provesRuntime(lease, facts, EXE)).toEqual({ok: true});
  });

  it('refuses a reused PID that started at another time', () => {
    const reused = {...facts, startedAt: local(2026, 8, 26, 16, 0, 0)};
    expect(provesRuntime(lease, reused, EXE)).toMatchObject({ok: false});
  });

  it('refuses a process running another program', () => {
    expect(provesRuntime(lease, {...facts, executable: '/usr/bin/python3'}, EXE)).toMatchObject({
      ok: false,
    });
  });

  it('refuses when the facts or the lease start time are missing', () => {
    expect(provesRuntime(lease, null, EXE)).toMatchObject({ok: false});
    expect(provesRuntime({startedAt: 'not a date'}, facts, EXE)).toMatchObject({ok: false});
  });
});

describe('readProcess', () => {
  it('proves nothing outside macOS', () => {
    expect(readProcess(123, 'linux', () => `Sat Sep 26 15:22:08 2026 ${EXE}`)).toBeNull();
  });

  it('proves nothing when ps fails or the PID is invalid', () => {
    const fails = () => {
      throw new Error('no such process');
    };
    expect(readProcess(123, 'darwin', fails)).toBeNull();
    expect(readProcess(0, 'darwin', () => `Sat Sep 26 15:22:08 2026 ${EXE}`)).toBeNull();
  });

  it('asks ps for exactly the start time and executable of one PID', () => {
    const calls: string[][] = [];
    readProcess(4242, 'darwin', (file, args) => {
      calls.push([file, ...args]);
      return `Sat Sep 26 15:22:08 2026 ${EXE}`;
    });
    expect(calls).toEqual([['/bin/ps', '-o', 'lstart=', '-o', 'comm=', '-p', '4242']]);
  });
});
