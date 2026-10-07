import {execFileSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  matchesSite,
  parseSkill,
  partOn,
  pythonEnvScript,
  Stack,
  suggestPythonBuild,
} from './addons';

describe('matchesSite', () => {
  it('matches hosts, ports and wildcards; never non-web pages', () => {
    expect(matchesSite(['localhost:*'], 'http://localhost:5173/app')).toBe(true);
    expect(matchesSite(['localhost:*'], 'http://127.0.0.1:5173/')).toBe(false);
    expect(matchesSite(['*.example.com'], 'https://shop.example.com/')).toBe(true);
    expect(matchesSite(['*.example.com'], 'https://example.com.evil.io/')).toBe(false);
    expect(matchesSite(['example.com:443'], 'https://example.com/')).toBe(true);
    expect(matchesSite(['*'], 'https://anything.dev/')).toBe(true);
    expect(matchesSite(['*'], 'file:///Users/me/page.html')).toBe(false);
    expect(matchesSite(['localhost'], 'not a url')).toBe(false);
  });
});

describe('partOn', () => {
  const stack: Stack = {
    id: 's',
    name: 'S',
    addons: {a: {enabled: true, off: {panel: true}}, b: {enabled: false, off: {}}},
  };
  it('needs the add-on on and the part not switched off', () => {
    expect(partOn(stack, 'a', 'script')).toBe(true);
    expect(partOn(stack, 'a', 'panel')).toBe(false);
    expect(partOn(stack, 'b', 'script')).toBe(false);
    expect(partOn(stack, 'missing', 'script')).toBe(false);
  });
});

describe('parseSkill', () => {
  it('reads a Claude-style SKILL.md', () => {
    const skill = parseSkill(
      '---\nname: ios-check\ndescription: "Check a page on real iOS Safari"\n---\n\n# Steps\n1. Switch the phone.'
    );
    expect(skill).toEqual({
      name: 'ios-check',
      description: 'Check a page on real iOS Safari',
      body: '# Steps\n1. Switch the phone.',
    });
  });
  it('treats a file without frontmatter as all body', () => {
    expect(parseSkill('Never change files outside src/.')).toEqual({
      name: '',
      description: '',
      body: 'Never change files outside src/.',
    });
  });
});

describe('Python environments', () => {
  it('suggests the install for what the project declares', () => {
    expect(suggestPythonBuild({env: 'uv', file: 'requirements.txt'})).toBe(
      'uv pip install -r requirements.txt'
    );
    expect(suggestPythonBuild({env: 'venv', file: 'pyproject.toml'})).toBe('pip install -e .');
    expect(suggestPythonBuild({env: 'conda', file: 'environment.yml'})).toBe('python --version');
  });

  it('makes the environment once, then runs the command inside it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "py env '"));
    const env = path.join(dir, 'env');
    const script = pythonEnvScript({env: 'venv', file: 'requirements.txt'}, env, true);
    const run = () =>
      execFileSync('/bin/sh', ['-c', `${script}python -c 'import sys; print(sys.prefix)'`])
        .toString()
        .trim();
    expect(fs.realpathSync(run())).toBe(fs.realpathSync(env));
    expect(fs.realpathSync(run())).toBe(fs.realpathSync(env));
    expect(pythonEnvScript({env: 'none', file: 'requirements.txt'}, env, true)).toBe('');
    expect(pythonEnvScript({env: 'uv', file: 'requirements.txt'}, env, false)).not.toContain(
      'uv venv'
    );
    fs.rmSync(dir, {recursive: true, force: true});
  }, 60_000);
});
