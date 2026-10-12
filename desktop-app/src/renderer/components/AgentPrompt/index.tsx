import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {AgentPrompt as Prompt} from 'common/agent-env';
import {useEffect, useRef, useState} from 'react';

/**
 * The question an agent triggers ("start this tunnel?"), shown in this window, naming
 * the agent and the exact thing it asks for. No answer in the time given is a no.
 */
const AgentPrompt = () => {
  const [queue, setQueue] = useState<Prompt[]>([]);
  const [left, setLeft] = useState(0);
  const deny = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => {
    const offShow = window.electron.ipcRenderer.on<Prompt>(IPC_MAIN_CHANNELS.AGENT_PROMPT, (p) => {
      if (p) setQueue((q) => [...q, p]);
    });
    const offHide = window.electron.ipcRenderer.on<string>(
      IPC_MAIN_CHANNELS.AGENT_PROMPT_HIDE,
      (id) => setQueue((q) => q.filter((p) => p.id !== id))
    );
    return () => {
      offShow?.();
      offHide?.();
    };
  }, []);

  // Count down to the automatic refusal; focus starts on Deny, the safe answer.
  useEffect(() => {
    if (!current) return undefined;
    setLeft(Math.ceil(current.timeoutMs / 1000));
    deny.current?.focus();
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;
  const answer = (allow: boolean) =>
    window.electron.ipcRenderer.invoke<unknown, unknown>(
      IPC_MAIN_CHANNELS.AGENT_PROMPT_ANSWER,
      current.id,
      allow
    );
  const total = Math.ceil(current.timeoutMs / 1000);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[110px]">
      <div
        role="alertdialog"
        aria-label={current.title}
        data-testid="agent-prompt"
        className="w-[520px] rounded-[14px] border border-accent bg-panel p-5 text-fg shadow-2xl"
      >
        <div className="text-[11px] text-muted">{current.agent} · this Session</div>
        <div className="my-1 text-[15px] font-bold">{current.title}</div>
        <div className="mt-3 rounded-lg bg-black/30 p-3 font-mono text-[12px] leading-[1.7]">
          {current.rows.map(([label, value]) => (
            <div key={label}>
              <span className="inline-block w-[64px] text-muted">{label}</span>
              {value}
            </div>
          ))}
        </div>
        {current.note ? (
          <p className="my-3 text-[11.5px] leading-[1.5] text-muted">{current.note}</p>
        ) : null}
        <div className="mb-3 h-[3px] overflow-hidden rounded bg-line">
          <div
            className="h-full bg-accent transition-[width] duration-1000 ease-linear"
            style={{width: `${(left / total) * 100}%`}}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[11.5px] text-muted">
            Refused automatically in {left} s
            {queue.length > 1 ? ` · ${queue.length - 1} more waiting` : ''}
          </span>
          <button
            ref={deny}
            type="button"
            onClick={() => answer(false)}
            className="h-[30px] rounded-lg border border-line px-[14px] text-[12.5px] hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => answer(true)}
            className="h-[30px] rounded-lg bg-accent px-[14px] text-[12.5px] font-bold text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-fg"
          >
            Allow once
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentPrompt;
