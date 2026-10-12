import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {sandboxMode, getSandbox} from '../sandbox';
import {
  askUser,
  audit,
  grantFor,
  isRemembered,
  remember,
  tunnelGrant,
} from '../terminal/agent-access';
import type {Capability} from '../../common/agent-env';
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
/** The permission for an agent to use the sandbox: off, remembered for this Session, or asked now. */
const permit = async (
  agent: string,
  capability: Capability,
  what: string,
  rows: [string, string][]
) => {
  if (sandboxMode() !== 'sandbox') {
    audit(agent, `${what} (this Session runs Local)`, 'refused');
    throw new Error(
      "Agents can only work inside a Session's Sandbox, and this Session runs Local (the user's Mac). Ask the user to choose Sandbox in the Environment view."
    );
  }
  if (!getSandbox().isRunning()) {
    audit(agent, `${what} (the sandbox is not running)`, 'refused');
    throw new Error(
      'The sandbox is not running. Ask the user to start it in the Environment view.'
    );
  }
  if (grantFor(agent, capability) === 'off') {
    audit(agent, `${what} (${capability} are off for this agent)`, 'refused');
    throw new Error(`The user has switched ${capability} off for you in the MCP panel.`);
  }
  if (!isRemembered(agent, capability)) {
    const answer = await askUser({
      agent,
      title: `${agent} wants to ${capability === 'commands' ? 'run commands' : 'use files'} in the sandbox`,
      rows,
      note: 'Inside the sandbox only: it cannot see your Mac. Allowing for this Session means you will not be asked again until the Session closes.',
      remember: true,
    });
    if (answer === 'deny') {
      audit(agent, `${what} (no, or no answer in 60 s)`, 'refused');
      throw new Error('The user did not allow this (denied, or no answer within 60 seconds).');
    }
    if (answer === 'session') remember(agent, capability);
    audit(
      agent,
      `${what} (${answer === 'session' ? 'allowed for this Session' : 'allowed once'})`,
      'allowed'
    );
  } else audit(agent, what, 'allowed');
  getSandbox().touch();
};

const oneLine = (text: string, max = 100) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

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
      const answer = await askUser({
        agent,
        title: `${agent} wants to start a tunnel`,
        rows: [
          ['name', def.name],
          ['server', `${def.host} (your ~/.ssh/config)`],
          ['reaches', `${def.remote} → this Mac's localhost:${def.localPort}`],
        ],
        note: 'It runs your own ssh with your keys. The agent cannot change this tunnel, only start it.',
      });
      if (answer === 'deny') {
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

  server.registerTool(
    'run_command',
    toolDefs.run_command,
    async ({command, cwd, timeout_s: timeout}) => {
      try {
        await permit(agent, 'commands', `run_command "${oneLine(command)}"`, [
          ['command', oneLine(command, 300)],
          ['in', cwd ? `workspace/${cwd}` : 'the sandbox workspace'],
        ]);
        return text(await getSandbox().runCommand(command, cwd, timeout));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool('read_file', toolDefs.read_file, async ({path: file}) => {
    try {
      await permit(agent, 'files', `read_file ${oneLine(file)}`, [['read', `workspace/${file}`]]);
      return {content: [{type: 'text' as const, text: await getSandbox().readFile(file)}]};
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('write_file', toolDefs.write_file, async ({path: file, content}) => {
    try {
      await permit(agent, 'files', `write_file ${oneLine(file)} (${content.length} chars)`, [
        ['write', `workspace/${file}`],
        ['size', `${content.length} characters`],
      ]);
      return text({path: file, bytes: await getSandbox().writeFile(file, content)});
    } catch (e) {
      return fail(e);
    }
  });
};
