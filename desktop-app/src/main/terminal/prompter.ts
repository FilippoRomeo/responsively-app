import {randomBytes} from 'crypto';
import {PROMPT_TIMEOUT_MS, type Answer, type AgentPrompt} from '../../common/agent-env';

/**
 * Asks you a yes/no question on behalf of an agent and waits: no answer in
 * 60 s is a refusal, and a window that cannot show the question is a refusal too.
 */
export class Prompter {
  private open = new Map<string, {resolve: (answer: Answer) => void; timer: NodeJS.Timeout}>();
  constructor(
    private readonly show: (prompt: AgentPrompt) => boolean,
    private readonly hide: (id: string) => void,
    private readonly timeoutMs = PROMPT_TIMEOUT_MS
  ) {}

  ask(input: Pick<AgentPrompt, 'agent' | 'title' | 'rows' | 'note' | 'remember'>): Promise<Answer> {
    const id = randomBytes(8).toString('hex');
    const prompt: AgentPrompt = {id, timeoutMs: this.timeoutMs, ...input};
    return new Promise((resolve) => {
      if (!this.show(prompt)) {
        resolve('deny');
        return;
      }
      const timer = setTimeout(() => this.finish(id, 'deny'), this.timeoutMs);
      this.open.set(id, {resolve, timer});
    });
  }

  /** The answer from the window; no for anything it does not recognise. `true` means once. */
  answer(id: unknown, answer: unknown) {
    if (typeof id !== 'string') return;
    this.finish(
      id,
      answer === true || answer === 'once' ? 'once' : answer === 'session' ? 'session' : 'deny'
    );
  }

  private finish(id: string, answer: Answer) {
    const entry = this.open.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.open.delete(id);
    this.hide(id);
    entry.resolve(answer);
  }

  /** Window closed: everything pending is refused. */
  refuseAll() {
    [...this.open.keys()].forEach((id) => this.finish(id, 'deny'));
  }
}
