import {startTerminalHost} from './host';

/** Entry of the utility process the controller starts: report the endpoint, then report how many terminals run. */
const port = (process as NodeJS.Process & {parentPort?: Electron.ParentPort}).parentPort;
startTerminalHost({onCount: (running) => port?.postMessage({type: 'count', running})})
  .then((host) => {
    // Ending the host ends its shells and tunnels, whichever way it is asked to go.
    const end = () => {
      host.stop();
      process.exit(0);
    };
    port?.on('message', (e) => e.data?.type === 'shutdown' && end());
    process.on('SIGTERM', end);
    process.on('exit', () => host.stop());
    port?.postMessage({type: 'ready', port: host.port, token: host.token});
    return host;
  })
  .catch((e) => {
    port?.postMessage({type: 'failed', message: e instanceof Error ? e.message : String(e)});
    process.exit(1);
  });
