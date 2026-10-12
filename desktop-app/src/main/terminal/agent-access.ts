import {ipcMain} from 'electron';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {
  DEFAULT_TUNNEL_GRANT,
  type AgentGrants,
  type AgentPrompt,
  type AuditLine,
  type TunnelGrant,
} from '../../common/agent-env';
import store from '../../store';
import log from '../logging';
import type {GetMainWindow} from '../mcp/bridge';
import {Prompter} from './prompter';

/**
 * What agents may do with this Session's tunnels: a grant per agent (ask each
 * time, or off), the question itself, and one audit line per call. Enforced
 * here, in the app, not in the stdio bridge.
 */
let prompter: Prompter | null = null;
let notify: (line: AuditLine) => void = () => {};
const lines: AuditLine[] = [];

export const grantsOf = (): Record<string, TunnelGrant> =>
  (store.get('envGrants') as Record<string, TunnelGrant> | undefined) ?? {};

export const tunnelGrant = (agent: string): TunnelGrant =>
  grantsOf()[agent] === 'off' ? 'off' : DEFAULT_TUNNEL_GRANT;

export const audit = (agent: string, text: string, outcome: AuditLine['outcome']) => {
  const line: AuditLine = {at: new Date().toISOString(), text: `${text} by ${agent}`, outcome};
  lines.unshift(line);
  lines.length = Math.min(lines.length, 30);
  log.info(`[env] ${line.text}: ${outcome}`);
  notify(line);
};

export const askUser = (input: Pick<AgentPrompt, 'agent' | 'title' | 'rows' | 'note'>) =>
  prompter ? prompter.ask(input) : Promise.resolve(false);

export const initAgentAccess = (getMainWindow: GetMainWindow, knownAgents: () => string[]) => {
  const win = () => {
    const w = getMainWindow();
    return w && !w.isDestroyed() ? w : null;
  };
  prompter = new Prompter(
    (prompt) => {
      const w = win();
      if (!w) return false;
      // The question must be seen: show the window without taking focus from what you are doing.
      if (!w.isVisible()) w.showInactive();
      w.webContents.send(IPC_MAIN_CHANNELS.AGENT_PROMPT, prompt);
      return true;
    },
    (id) => win()?.webContents.send(IPC_MAIN_CHANNELS.AGENT_PROMPT_HIDE, id)
  );
  notify = (line) => win()?.webContents.send(IPC_MAIN_CHANNELS.ENV_AUDIT_EVENT, line);

  ipcMain.removeHandler(IPC_MAIN_CHANNELS.AGENT_PROMPT_ANSWER);
  ipcMain.handle(IPC_MAIN_CHANNELS.AGENT_PROMPT_ANSWER, (_e, id: unknown, allow: unknown) =>
    prompter?.answer(id, allow)
  );
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.ENV_GRANTS_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.ENV_GRANTS_LIST, (): AgentGrants[] =>
    [...new Set([...knownAgents(), ...Object.keys(grantsOf())])].map((name) => ({
      name,
      tunnels: tunnelGrant(name),
    }))
  );
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.ENV_GRANT_SET);
  ipcMain.handle(IPC_MAIN_CHANNELS.ENV_GRANT_SET, (_e, name: unknown, tunnels: unknown) => {
    if (typeof name !== 'string' || name.length === 0 || name.length > 80)
      throw new Error('Unknown agent');
    if (tunnels !== 'ask' && tunnels !== 'off') throw new Error('Choose ask or off');
    store.set('envGrants', {...grantsOf(), [name]: tunnels});
    audit('you', `tunnels for ${name} set to ${tunnels}`, 'allowed');
    return true;
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.ENV_AUDIT_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.ENV_AUDIT_LIST, (): AuditLine[] => lines.slice(0, 12));
  win()?.once('closed', () => prompter?.refuseAll());
};
