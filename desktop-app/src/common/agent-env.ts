/** What an agent may do to a Session's terminals and tunnels, and the question it asks you. */
export type TunnelGrant = 'ask' | 'off';
export const DEFAULT_TUNNEL_GRANT: TunnelGrant = 'ask';
/** The things an agent can be allowed: tunnels, commands in the sandbox, files in its workspace. */
export type Capability = 'tunnels' | 'commands' | 'files';
export const CAPABILITIES: Capability[] = ['tunnels', 'commands', 'files'];
/** What you answered: no, this once, or for the rest of this Session. */
export type Answer = 'deny' | 'once' | 'session';
export const PROMPT_TIMEOUT_MS = 60_000;

export interface AgentPrompt {
  id: string;
  agent: string;
  title: string;
  /** Label / value pairs: the exact thing being asked for. */
  rows: [string, string][];
  note?: string;
  /** Offer "Allow for this Session" besides "Allow once". */
  remember?: boolean;
  timeoutMs: number;
}

export interface AuditLine {
  at: string;
  text: string;
  outcome: 'allowed' | 'refused';
}

export interface AgentGrants {
  name: string;
  tunnels: TunnelGrant;
  commands: TunnelGrant;
  files: TunnelGrant;
}
