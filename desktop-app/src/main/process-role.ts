/**
 * Every main process is exactly one of these, decided once from its launch environment:
 * - controller: headless Sessions authority (launched with RESPONSIVELY_SESSION_CONTROLLER=true)
 * - session: one isolated Session runtime (launched with RESPONSIVELY_SESSION_ID)
 * - shell: the Dock/menu-bar owner, or a plain app launch
 * The controller wins if both are set.
 */
export type ProcessRole = 'controller' | 'session' | 'shell';

export const processRole = (env: NodeJS.ProcessEnv = process.env): ProcessRole => {
  if (env.RESPONSIVELY_SESSION_CONTROLLER === 'true') return 'controller';
  if (env.RESPONSIVELY_SESSION_ID) return 'session';
  return 'shell';
};
