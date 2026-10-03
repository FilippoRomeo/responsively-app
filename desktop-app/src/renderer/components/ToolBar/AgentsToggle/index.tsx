import {Icon} from '@iconify/react';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {McpServerStatus} from 'main/mcp';
import {useEffect, useState} from 'react';
import {ToolbarAction} from '../primitives';

/** Connects or disconnects AI agents (this window's MCP server) in one click. */
const AgentsToggle = () => {
  const [status, setStatus] = useState<McpServerStatus | null>(null);

  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<never, McpServerStatus>(IPC_MAIN_CHANNELS.MCP_STATUS)
      .then(setStatus)
      .catch(() => {});
    // Also changed from Manage Sessions, the menu-bar menu or the MCP panel.
    return window.electron.ipcRenderer.on<McpServerStatus>(
      IPC_MAIN_CHANNELS.MCP_STATUS_CHANGED,
      setStatus
    );
  }, []);

  const connected = status?.enabled ?? false;
  return (
    <ToolbarAction
      onClick={() => {
        window.electron.ipcRenderer
          .invoke<{enabled: boolean}, McpServerStatus>(IPC_MAIN_CHANNELS.MCP_SET_ENABLED, {
            enabled: !connected,
          })
          .then(setStatus)
          .catch(() => {});
      }}
      isActive={connected}
      disabled={status === null}
      title={
        connected ? 'Disconnect AI agents from this window' : 'Connect AI agents to this window'
      }
    >
      <Icon icon={connected ? 'lucide:bot' : 'lucide:bot-off'} fontSize={15} />
      {connected ? 'Agents' : 'No agents'}
    </ToolbarAction>
  );
};

export default AgentsToggle;
