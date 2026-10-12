import {startTerminalHost} from './host';

/** Entry of the utility process the controller starts: report the endpoint, then report how many terminals run. */
const port = (process as NodeJS.Process & {parentPort?: Electron.ParentPort}).parentPort;
startTerminalHost({onCount: (running) => port?.postMessage({type: 'count', running})})
  .then((host) => port?.postMessage({type: 'ready', port: host.port, token: host.token}))
  .catch((e) => {
    port?.postMessage({type: 'failed', message: e instanceof Error ? e.message : String(e)});
    process.exit(1);
  });
