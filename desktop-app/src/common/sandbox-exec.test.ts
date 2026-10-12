import {describe, expect, it} from 'vitest';
import {
  clampTimeout,
  commandScript,
  readScript,
  shellQuote,
  tailOutput,
  workspacePath,
  writeScript,
} from './sandbox-exec';

describe('shellQuote', () => {
  it('keeps any text as one word', () => {
    expect(shellQuote("it's $HOME; rm -rf /")).toBe(`'it'\\''s $HOME; rm -rf /'`);
  });
});

describe('workspacePath', () => {
  it('makes plain relative paths', () => {
    expect(workspacePath('src/app.ts')).toBe('src/app.ts');
    expect(workspacePath('./a//b/../c.txt')).toBe('a/c.txt');
  });
  it('refuses a way out, empty paths and odd characters', () => {
    expect(() => workspacePath('../etc/passwd')).toThrow(/inside/);
    expect(() => workspacePath('/etc/passwd')).toThrow(/relative/);
    expect(() => workspacePath('~/notes.md')).toThrow(/relative/);
    expect(() => workspacePath('a/../../b')).toThrow(/inside/);
    expect(() => workspacePath('')).toThrow();
    expect(() => workspacePath('.')).toThrow();
    expect(() => workspacePath('a\0b')).toThrow();
    expect(() => workspacePath(42)).toThrow();
  });
});

describe('scripts', () => {
  it('resolve the path again on the machine and refuse anything outside the workspace', () => {
    expect(readScript('a b/c.txt')).toContain('realpath -m -- "$w"/\'a b/c.txt\'');
    expect(readScript('x')).toContain('Outside the workspace');
    expect(writeScript('x')).toContain('Outside the workspace');
  });
  it('runs a command with a hard limit, in the workspace', () => {
    const s = commandScript("echo 'hi'", undefined, 30);
    expect(s).toContain('setsid bash -l -c');
    expect(s).toContain('sleep 30');
    expect(s).toContain('kill -KILL -- -"$pid"');
    expect(s).toContain('cd "$w"');
    expect(commandScript('ls', 'app/src', 5)).toContain('realpath -m -- "$w"/\'app/src\'');
    expect(() => commandScript('ls', '../x', 5)).toThrow(/inside/);
  });
});

describe('limits', () => {
  it('clamps the timeout and keeps the end of long output', () => {
    expect(clampTimeout(undefined)).toBe(60);
    expect(clampTimeout(5)).toBe(5);
    expect(clampTimeout(99999)).toBe(600);
    expect(clampTimeout(-3)).toBe(60);
    expect(tailOutput('abcdef', 3)).toEqual({text: 'def', truncated: true});
    expect(tailOutput('abc', 10)).toEqual({text: 'abc', truncated: false});
  });
});
