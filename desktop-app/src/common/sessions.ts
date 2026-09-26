/** Who ended a Session's last run. Set by the component that stopped it, never by the caller. */
export type SessionStopCause = 'user' | 'window' | 'quit' | 'agent' | 'crash';
/** A stop request's origin; a crash is detected by the controller, never requested. */
export type SessionStopSource = Exclude<SessionStopCause, 'crash'>;
export interface SessionDefinition {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  lastUrl?: string;
  lastStop?: {by: SessionStopCause; at: string};
}
export type SessionStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export interface SessionRuntime {
  pid: number;
  mcpPort: number | null;
  browserSyncPort: number;
  userDataDir: string;
  startedAt: string;
}
export interface SessionInfo extends SessionDefinition {
  status: SessionStatus;
  runtime?: SessionRuntime;
  devices?: string[];
  error?: string;
  /** The process is alive but its authenticated endpoint does not answer. */
  hung?: boolean;
}
export type SessionOperation =
  | 'list'
  | 'get'
  | 'create'
  | 'rename'
  | 'open'
  | 'focus'
  | 'stop'
  | 'delete'
  | 'reset'
  | 'attention'
  | 'force-stop';
export interface SessionRequest {
  operation: SessionOperation;
  id?: string;
  name?: string;
  url?: string;
  open?: boolean;
  confirmed?: boolean;
  source?: SessionStopSource;
}
