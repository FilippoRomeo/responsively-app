import {describeConditions, type TestConditions} from './test-conditions';

/**
 * What one test cell measured. Only facts the browser reported: judging them
 * ("too slow", "broken on 3G") is left to whoever reads the report.
 */
export interface CellResult {
  index: number;
  device: {name: string; width: number; height: number};
  page: string;
  /** Where the page ended up (redirects). */
  finalUrl: string | null;
  conditions: TestConditions;
  /** The page finished loading inside the time limit. */
  loaded: boolean;
  error?: string;
  timings: {
    ttfbMs: number | null;
    domContentLoadedMs: number | null;
    loadMs: number | null;
    lcpMs: number | null;
    cls: number | null;
  };
  transfer: {requests: number; bytes: number; failed: {url: string; error: string}[]};
  cpu: {scriptMs: number | null; taskMs: number | null};
  memory: {jsHeapMB: number | null};
  console: {errors: number; warnings: number; messages: string[]};
  layout: {
    horizontalOverflow: boolean | null;
    scrollWidth: number | null;
    viewportWidth: number | null;
  };
  /** File name of the screenshot, next to the report. */
  screenshot?: string;
}

export interface TestReport {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  status: 'running' | 'complete' | 'stopped' | 'failed';
  startedBy: 'agent' | 'user';
  /** Devices asked for but not measured, and why (for example real iOS Safari). */
  skipped: {device: string; reason: string}[];
  request: {
    pages: string[];
    devices: string[];
    networks: string[];
    cpus: number[];
    schemes: (string | null)[];
  };
  cells: CellResult[];
  note?: string;
}

const ms = (value: number | null) => (value === null ? '–' : `${Math.round(value)} ms`);
const kb = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** A compact Markdown table plus the problems found; what an agent reads first. */
export const renderReportMarkdown = (report: TestReport): string => {
  const lines: string[] = [];
  lines.push(`# Test report ${report.id}`);
  lines.push('');
  lines.push(
    `Status: **${report.status}** · ${report.cells.length} measurements · started by ${report.startedBy} · ${report.createdAt}`
  );
  lines.push('');
  lines.push(
    '_Measured values only. Network and CPU are throttled by the browser, so absolute times are relative to this Mac._'
  );
  if (report.note) lines.push('', report.note);
  lines.push('');
  lines.push(
    '| Page | Device | Conditions | Load | LCP | CLS | Requests | Transferred | CPU script | Errors | Overflow |'
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of report.cells) {
    lines.push(
      `| ${cell(c.page)} | ${cell(c.device.name)} | ${cell(describeConditions(c.conditions))} | ${
        c.loaded ? ms(c.timings.loadMs) : 'not loaded'
      } | ${ms(c.timings.lcpMs)} | ${c.timings.cls === null ? '–' : c.timings.cls.toFixed(3)} | ${
        c.transfer.requests
      } | ${kb(c.transfer.bytes)} | ${ms(c.cpu.scriptMs)} | ${c.console.errors + c.transfer.failed.length} | ${
        c.layout.horizontalOverflow === null ? '–' : c.layout.horizontalOverflow ? 'yes' : 'no'
      } |`
    );
  }
  const problems = report.cells.filter(
    (c) => !c.loaded || c.console.errors > 0 || c.transfer.failed.length > 0 || c.error
  );
  if (problems.length > 0) {
    lines.push('', '## Problems seen');
    for (const c of problems) {
      lines.push('', `### ${c.device.name} · ${describeConditions(c.conditions)} · ${c.page}`);
      if (c.error) lines.push(`- ${c.error}`);
      for (const f of c.transfer.failed.slice(0, 5))
        lines.push(`- failed request: ${f.url} (${f.error})`);
      for (const m of c.console.messages.slice(0, 5)) lines.push(`- console: ${m}`);
    }
  }
  if (report.skipped.length > 0) {
    lines.push('', '## Not measured');
    for (const s of report.skipped) lines.push(`- ${s.device}: ${s.reason}`);
  }
  return `${lines.join('\n')}\n`;
};
