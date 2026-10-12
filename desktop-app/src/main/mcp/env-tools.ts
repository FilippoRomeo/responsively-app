import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {tunnelGrant, askUser, audit} from '../terminal/agent-access';
import {getEnvApi} from '../terminal/env-api';
import {toolDefs} from './toolDefs';

const text = (value: unknown) => ({
  content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}],
});
const fail = (error: unknown) => ({
  content: [{type: 'text' as const, text: error instanceof Error ? error.message : String(error)}],
  isError: true,
});

/**
 * The Session's terminals and tunnels, for agents. Reads are always allowed;
 * starting a tunnel asks you each time unless you switched tunnels off for this
 * agent. Nothing here can create or edit a tunnel, open a shell, or type into one.
 */
export const registerEnvTools = (server: McpServer, agent: string) => {
  const summarize = (t: Awaited<ReturnType<ReturnType<typeof getEnvApi>['tunnels']>>[number]) => ({
    name: t.def.name,
    server: t.def.host,
    remote: t.def.remote,
    localPort: t.state === 'stopped' ? t.def.localPort : t.localPort,
    state: t.state,
    ...(t.detail ? {detail: t.detail} : {}),
  });

  server.registerTool('env_status', toolDefs.env_status, async () => {
    try {
      const env = getEnvApi();
      const [terminals, tunnels, ports] = await Promise.all([
        env.terminalCount(),
        env.tunnels(),
        env.ports(),
      ]);
      return text({terminals, tunnels: tunnels.map(summarize), openPorts: ports.length});
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('list_ports', toolDefs.list_ports, async () => {
    try {
      return text(await getEnvApi().ports());
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('list_tunnels', toolDefs.list_tunnels, async () => {
    try {
      return text((await getEnvApi().tunnels()).map(summarize));
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('start_tunnel', toolDefs.start_tunnel, async ({tunnel}) => {
    try {
      const env = getEnvApi();
      const def = env.savedTunnel(tunnel);
      if (!def) {
        audit(agent, `start_tunnel "${tunnel}" (no such saved tunnel)`, 'refused');
        throw new Error(
          `There is no saved tunnel called "${tunnel}". Saved: ${env.savedNames().join(', ') || 'none'}. You cannot create tunnels; ask the user to save one.`
        );
      }
      const already = (await env.tunnels()).find((t) => t.def.id === def.id);
      if (already && ['connected', 'connecting', 'reconnecting'].includes(already.state))
        return text(summarize(already));
      if (tunnelGrant(agent) === 'off') {
        audit(agent, `start_tunnel "${def.name}" (tunnels are off for this agent)`, 'refused');
        throw new Error(
          'The user has switched tunnels off for you in the MCP panel, so this was refused.'
        );
      }
      const allowed = await askUser({
        agent,
        title: `${agent} wants to start a tunnel`,
        rows: [
          ['name', def.name],
          ['server', `${def.host} (your ~/.ssh/config)`],
          ['reaches', `${def.remote} → this Mac's localhost:${def.localPort}`],
        ],
        note: 'It runs your own ssh with your keys. The agent cannot change this tunnel, only start it.',
      });
      if (!allowed) {
        audit(agent, `start_tunnel "${def.name}" (no, or no answer in 60 s)`, 'refused');
        throw new Error('The user did not allow this (denied, or no answer within 60 seconds).');
      }
      audit(agent, `start_tunnel "${def.name}" (allowed once)`, 'allowed');
      return text(summarize(await env.startTunnel(def)));
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('stop_tunnel', toolDefs.stop_tunnel, async ({tunnel}) => {
    try {
      const env = getEnvApi();
      const def = env.savedTunnel(tunnel);
      if (!def) throw new Error(`There is no saved tunnel called "${tunnel}".`);
      if (tunnelGrant(agent) === 'off') {
        audit(agent, `stop_tunnel "${def.name}" (tunnels are off for this agent)`, 'refused');
        throw new Error('The user has switched tunnels off for you in the MCP panel.');
      }
      await env.stopTunnel(def.id);
      audit(agent, `stop_tunnel "${def.name}"`, 'allowed');
      return text({name: def.name, state: 'stopped'});
    } catch (e) {
      return fail(e);
    }
  });
};
