// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AgentPrompt} from '../../common/agent-env';
import {Prompter} from './prompter';

const ask = (p: Prompter) =>
  p.ask({agent: 'Claude Code', title: 'start a tunnel', rows: [['name', 'ComfyUI']]});

describe('Prompter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with what you answered', async () => {
    let shown: AgentPrompt | undefined;
    const hidden: string[] = [];
    const p = new Prompter(
      (x) => ((shown = x), true),
      (id) => hidden.push(id)
    );
    const yes = ask(p);
    expect(shown?.agent).toBe('Claude Code');
    p.answer(shown!.id, true);
    expect(await yes).toBe('once');
    expect(hidden).toEqual([shown!.id]);

    const no = ask(p);
    p.answer(shown!.id, false);
    expect(await no).toBe('deny');
  });

  it('refuses after the timeout, and ignores a late or forged answer', async () => {
    let shown: AgentPrompt | undefined;
    const p = new Prompter(
      (x) => ((shown = x), true),
      () => {},
      60_000
    );
    const result = ask(p);
    vi.advanceTimersByTime(60_000);
    expect(await result).toBe('deny');
    p.answer(shown!.id, true);
    p.answer('nope', true);
    p.answer(42, true);
  });

  it('refuses at once when the window cannot show the question', async () => {
    const p = new Prompter(
      () => false,
      () => {}
    );
    expect(await ask(p)).toBe('deny');
  });

  it('can be allowed for the rest of the Session', async () => {
    let shown: AgentPrompt | undefined;
    const p = new Prompter(
      (x) => ((shown = x), true),
      () => {}
    );
    const r = ask(p);
    p.answer(shown!.id, 'session');
    expect(await r).toBe('session');
  });

  it('only a literal true allows', async () => {
    let shown: AgentPrompt | undefined;
    const p = new Prompter(
      (x) => ((shown = x), true),
      () => {}
    );
    const r = ask(p);
    p.answer(shown!.id, 'true');
    expect(await r).toBe('deny');
  });

  it('refuses everything pending when the window goes', async () => {
    const p = new Prompter(
      () => true,
      () => {}
    );
    const a = ask(p);
    const b = ask(p);
    p.refuseAll();
    expect([await a, await b]).toEqual(['deny', 'deny']);
  });
});
