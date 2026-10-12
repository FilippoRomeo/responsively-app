import {randomBytes} from 'crypto';
import {PROMPT_TIMEOUT_MS, type AgentPrompt} from '../../common/agent-env';

/**
 * Asks you a yes/no question on behalf of an agent and waits: no answer in
 * 60 s is a refusal, and a window that cannot show the question is a refusal too.
 */
export class Prompter {
  private open = new Map<string, {resolve: (allow: boolean) => void; timer: NodeJS.Timeout}>();
  constructor(
    private readonly show: (prompt: AgentPrompt) => boolean,
    private readonly hide: (id: string) => void,
    private readonly timeoutMs = PROMPT_TIMEOUT_MS
  ) {}

  ask(input: Pick<AgentPrompt, 'agent' | 'title' | 'rows' | 'note'>): Promise<boolean> {
    const id = randomBytes(8).toString('hex');
    const prompt: AgentPrompt = {id, timeoutMs: this.timeoutMs, ...input};
    return new Promise((resolve) => {
      if (!this.show(prompt)) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => this.finish(id, false), this.timeoutMs);
      this.open.set(id, {resolve, timer});
    });
  }

  /** The answer from the window; false for anything it does not recognise. */
  answer(id: unknown, allow: unknown) {
    if (typeof id === 'string') this.finish(id, allow === true);
  }

  private finish(id: string, allow: boolean) {
    const entry = this.open.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.open.delete(id);
    this.hide(id);
    entry.resolve(allow);
  }

  /** Window closed: everything pending is refused. */
  refuseAll() {
    [...this.open.keys()].forEach((id) => this.finish(id, false));
  }
}
