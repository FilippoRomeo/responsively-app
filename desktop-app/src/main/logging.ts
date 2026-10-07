import path from 'path';
import {app} from 'electron';
import log from 'electron-log';

/**
 * Central logging + crash capture for the main process. File transport lands
 * in the platform log directory (~/Library/Logs/ResponsivelyApp on macOS), so
 * field issues finally leave a trace.
 */
export const initLogging = () => {
  if (process.env.RESPONSIVELY_SESSION_ID)
    log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs', 'main.log');
  // An isolated copy (Gate C) logs into its own folder, not the installed app's
  // log, which is keyed by the shared app name.
  else if (process.env.RESPONSIVELY_LOG_DIR) {
    const file = process.env.RESPONSIVELY_SESSION_CONTROLLER ? 'controller.log' : 'main.log';
    log.transports.file.resolvePath = () => path.join(process.env.RESPONSIVELY_LOG_DIR!, file);
  }
  log.transports.file.level = 'info';
  log.transports.console.level =
    process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true' ? 'debug' : 'warn';
  // uncaughtException + unhandledRejection
  log.catchErrors({showDialog: false});
};

export const initCrashHandlers = () => {
  app.on('render-process-gone', (_event, webContents, details) => {
    log.error('[crash] renderer process gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      url: webContents.getURL(),
    });
  });
  app.on('child-process-gone', (_event, details) => {
    log.error('[crash] child process gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
};

export default log;
