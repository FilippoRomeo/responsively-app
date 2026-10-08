import {sessionRequest} from '../sessions/service';
import {SessionRequest} from '../../common/sessions';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {webContents} from 'electron';
import {
  McpAppState,
  McpCaptureTargetsResult,
  McpDeviceInfo,
  McpNavigateResult,
  McpSetActiveDevicesResult,
  McpSkippedCapture,
} from '../../common/mcp';
import {captureImage} from '../screenshot';
import {simulatorScreenshot} from '../ios-simulator';
import {GetMainWindow, sendBridgeCommand} from './bridge';
import {clickElement, evaluateInPage, readPage, typeText} from './interactions';
import {callAddonTool, getPrompts, getRules, listAddonTools} from '../addons';
import {clearConditions, runTest, setConditions} from '../testing/engine';
import {listReports, readReport, reportsDir} from '../testing/reports';
import {renderReportMarkdown} from '../../common/test-report';
import type {ColorScheme} from '../../common/test-conditions';
import path from 'path';
import {toolDefs} from './toolDefs';
import {normalizeUrl} from './utils';

const MAX_SCREENSHOT_WIDTH = 1000;
const SCREENSHOT_JPEG_QUALITY = 80;
const NAVIGATE_BRIDGE_TIMEOUT_MS = 35_000;

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

const textResult = (value: unknown) => ({
  content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}],
});

const errorResult = (error: unknown) => ({
  content: [{type: 'text' as const, text: error instanceof Error ? error.message : String(error)}],
  isError: true,
});

const captureTarget = async (
  target: McpCaptureTargetsResult['targets'][number]
): Promise<{content: [TextContent, ImageContent]} | {skip: McpSkippedCapture}> => {
  const {iosRuntime} = target;
  if (!iosRuntime) {
    const targetContents = webContents.fromId(target.webContentsId);
    if (targetContents === undefined || targetContents.isDestroyed()) {
      return {skip: {deviceName: target.deviceName, reason: 'the preview was closed'}};
    }
  }
  let image: Electron.NativeImage | null | undefined;
  try {
    image = iosRuntime
      ? await simulatorScreenshot(target.deviceName, iosRuntime)
      : await captureImage(target.webContentsId);
    if (image === null) {
      return {skip: {deviceName: target.deviceName, reason: 'iOS Safari is still starting'}};
    }
  } catch (error) {
    return {
      skip: {
        deviceName: target.deviceName,
        reason: `capture failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  if (image === undefined || image.isEmpty()) {
    return {
      skip: {
        deviceName: target.deviceName,
        reason: 'capture returned an empty image (the app window may be hidden or minimized)',
      },
    };
  }
  const resized =
    image.getSize().width > MAX_SCREENSHOT_WIDTH
      ? image.resize({width: MAX_SCREENSHOT_WIDTH})
      : image;
  return {
    content: [
      {
        type: 'text',
        text: `${target.deviceName} (${target.width}x${target.height})${iosRuntime ? ' — real iOS Safari' : ''} — ${target.url}`,
      },
      {
        type: 'image',
        data: resized.toJPEG(SCREENSHOT_JPEG_QUALITY).toString('base64'),
        mimeType: 'image/jpeg',
      },
    ],
  };
};

export const registerTools = (server: McpServer, getMainWindow: GetMainWindow) => {
  const manage = async (request: SessionRequest) => {
    try {
      if (request.operation === 'stop' && request.id === process.env.RESPONSIVELY_SESSION_ID)
        throw new Error(
          'To stop this Session, use stop_session through the stdio MCP bridge or the Sessions manager.'
        );
      return textResult(await sessionRequest(request));
    } catch (error) {
      return errorResult(error);
    }
  };
  server.registerTool('list_sessions', toolDefs.list_sessions, () => manage({operation: 'list'}));
  server.registerTool('create_session', toolDefs.create_session, (args) =>
    manage({operation: 'create', ...args})
  );
  server.registerTool('get_session', toolDefs.get_session, ({id}) =>
    manage({operation: 'get', id})
  );
  server.registerTool('open_session', toolDefs.open_session, ({id}) =>
    manage({operation: 'open', id})
  );
  server.registerTool('focus_session', toolDefs.focus_session, ({id}) =>
    manage({operation: 'focus', id})
  );
  server.registerTool('stop_session', toolDefs.stop_session, ({id}) =>
    manage({operation: 'stop', id, source: 'agent'})
  );
  server.registerTool('get_app_state', toolDefs.get_app_state, async () => {
    try {
      const state = await sendBridgeCommand<McpAppState>(getMainWindow, 'get-app-state');
      return textResult(state);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('navigate', toolDefs.navigate, async ({url}) => {
    try {
      const normalizedUrl = normalizeUrl(url);
      const result = await sendBridgeCommand<McpNavigateResult>(
        getMainWindow,
        'navigate',
        {url: normalizedUrl},
        NAVIGATE_BRIDGE_TIMEOUT_MS
      );
      return textResult(result);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_devices', toolDefs.list_devices, async () => {
    try {
      const devices = await sendBridgeCommand<McpDeviceInfo[]>(getMainWindow, 'list-devices');
      return textResult(devices);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('set_active_devices', toolDefs.set_active_devices, async ({devices}) => {
    try {
      const result = await sendBridgeCommand<McpSetActiveDevicesResult>(
        getMainWindow,
        'set-active-devices',
        {devices}
      );
      return textResult(result);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool(
    'set_device_browser',
    toolDefs.set_device_browser,
    async ({device, browser, ios_version: iosVersion}) => {
      try {
        return textResult(
          await sendBridgeCommand(getMainWindow, 'set-device-browser', {
            device,
            browser,
            iosVersion,
          })
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // The previews a test tool means: one by id or name, or every Chromium preview.
  const previewIds = async (device?: string) => {
    const {targets} = await sendBridgeCommand<McpCaptureTargetsResult>(
      getMainWindow,
      'get-capture-targets',
      {device}
    );
    const chromium = targets.filter((t) => !t.iosRuntime);
    if (chromium.length === 0)
      throw new Error(
        device ? `${device} has no Chromium preview to throttle.` : 'No Chromium preview is open.'
      );
    return chromium;
  };

  server.registerTool(
    'set_conditions',
    toolDefs.set_conditions,
    async ({device, network, cpu, color_scheme: scheme}) => {
      try {
        if (network === undefined && cpu === undefined && scheme === undefined)
          throw new Error('Give at least one of network, cpu or color_scheme.');
        const applied = [];
        for (const t of await previewIds(device))
          applied.push({
            device: t.deviceName,
            conditions: await setConditions(t.webContentsId, {
              ...(network !== undefined ? {network} : {}),
              ...(cpu !== undefined ? {cpu} : {}),
              ...(scheme !== undefined
                ? {scheme: scheme === 'default' ? null : (scheme as ColorScheme)}
                : {}),
            }),
          });
        return textResult(applied);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool('clear_conditions', toolDefs.clear_conditions, async ({device}) => {
    try {
      const cleared = [];
      for (const t of await previewIds(device)) {
        await clearConditions(t.webContentsId);
        cleared.push(t.deviceName);
      }
      return textResult({cleared});
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool(
    'run_test',
    toolDefs.run_test,
    async ({
      pages,
      devices,
      networks,
      cpu,
      color_schemes: schemes,
      settle_ms: settleMs,
      screenshots,
    }) => {
      try {
        const report = await runTest(getMainWindow, {
          pages,
          devices,
          networks,
          cpus: cpu,
          schemes: schemes as ColorScheme[] | undefined,
          settleMs,
          screenshots,
          startedBy: 'agent',
        });
        if (report.status === 'failed') throw new Error(report.note ?? 'The test run failed.');
        return textResult({
          id: report.id,
          status: report.status,
          measurements: report.cells.length,
          folder: path.join(reportsDir(), report.id),
          markdown: renderReportMarkdown(report),
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool('list_reports', toolDefs.list_reports, async () => {
    try {
      return textResult(listReports());
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('get_report', toolDefs.get_report, async ({id, format}) => {
    try {
      const report = readReport(id);
      const folder = path.join(reportsDir(), id);
      return textResult(
        format === 'json' ? {folder, report} : {folder, markdown: renderReportMarkdown(report)}
      );
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('evaluate', toolDefs.evaluate, async ({expression, device}) => {
    try {
      return textResult(await evaluateInPage(getMainWindow, expression, device));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_addon_tools', toolDefs.list_addon_tools, async () => {
    try {
      return textResult(await listAddonTools());
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool(
    'call_addon_tool',
    toolDefs.call_addon_tool,
    async ({addon, tool, arguments: args}) => {
      try {
        // Relay the add-on's own result (text, images…) as it is.
        return (await callAddonTool(addon, tool, args ?? {})) as never;
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool('get_rules', toolDefs.get_rules, async ({name}) => {
    try {
      return textResult(getRules(name));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('get_prompts', toolDefs.get_prompts, async ({name}) => {
    try {
      return textResult(getPrompts(name));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('read_page', toolDefs.read_page, async ({device}) => {
    try {
      return textResult(await readPage(getMainWindow, device));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('click', toolDefs.click, async ({selector, device}) => {
    try {
      return textResult(await clickElement(getMainWindow, selector, device));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool(
    'type_text',
    toolDefs.type_text,
    async ({text, selector, clear, pressEnter, device}) => {
      try {
        return textResult(
          await typeText(getMainWindow, {text, selector, clear, pressEnter, device})
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool('screenshot', toolDefs.screenshot, async ({device}) => {
    try {
      const {targets, skipped} = await sendBridgeCommand<McpCaptureTargetsResult>(
        getMainWindow,
        'get-capture-targets',
        {device}
      );
      if (targets.length === 0 && skipped.length === 0) {
        return errorResult(
          new Error('No active devices to capture. Use the set_active_devices tool first.')
        );
      }
      const captures = await Promise.all(targets.map(captureTarget));
      const content: Array<TextContent | ImageContent> = [];
      const skips: McpSkippedCapture[] = [...skipped];
      captures.forEach((capture) => {
        if ('skip' in capture) {
          skips.push(capture.skip);
        } else {
          content.push(...capture.content);
        }
      });
      if (skips.length > 0) {
        content.push({
          type: 'text',
          text: `Skipped: ${skips.map((s) => `${s.deviceName} (${s.reason})`).join('; ')}`,
        });
      }
      return {content};
    } catch (error) {
      return errorResult(error);
    }
  });
};
