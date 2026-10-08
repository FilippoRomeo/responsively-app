import fs from 'fs';
import path from 'path';
import {app} from 'electron';
import {renderReportMarkdown, type TestReport} from '../../common/test-report';

/**
 * Test reports live with the Session that ran them (its own user-data folder),
 * newest first, and only the latest KEEP are kept: they are regenerable, not
 * your data. Each report is a folder: report.json, report.md, one screenshot
 * per measurement.
 */
export const KEEP_REPORTS = 20;
const ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

export const reportsDir = () => path.join(app.getPath('userData'), 'test-reports');
const dirOf = (id: string) => {
  if (!ID.test(id)) throw new Error('Not a report id');
  return path.join(reportsDir(), id);
};

export const newReportId = (now = new Date()) => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const day = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${day}-${time}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
};

export const saveScreenshot = (id: string, name: string, jpeg: Buffer) => {
  fs.mkdirSync(dirOf(id), {recursive: true});
  fs.writeFileSync(path.join(dirOf(id), name), jpeg);
};

export const saveReport = (report: TestReport) => {
  const dir = dirOf(report.id);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), renderReportMarkdown(report));
};

export interface ReportSummary {
  id: string;
  createdAt: string;
  status: TestReport['status'];
  measurements: number;
  bytes: number;
  folder: string;
}

const sizeOf = (dir: string): number =>
  fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);

export const readReport = (id: string): TestReport =>
  JSON.parse(fs.readFileSync(path.join(dirOf(id), 'report.json'), 'utf8')) as TestReport;

export const listReports = (): ReportSummary[] => {
  if (!fs.existsSync(reportsDir())) return [];
  return fs
    .readdirSync(reportsDir())
    .filter((id) => ID.test(id))
    .flatMap((id) => {
      try {
        const report = readReport(id);
        return [
          {
            id,
            createdAt: report.createdAt,
            status: report.status,
            measurements: report.cells.length,
            bytes: sizeOf(dirOf(id)),
            folder: dirOf(id),
          },
        ];
      } catch {
        return []; // a half-written folder: ignored, never listed
      }
    })
    .sort((a, b) => b.id.localeCompare(a.id));
};

export const deleteReport = (id: string) => fs.rmSync(dirOf(id), {recursive: true, force: true});

export const pruneReports = (keep = KEEP_REPORTS) =>
  listReports()
    .slice(keep)
    .forEach((r) => deleteReport(r.id));

/** The report with its screenshots inlined, for the viewer. */
export const readReportWithImages = (id: string) => {
  const report = readReport(id);
  const images: Record<string, string> = {};
  for (const cell of report.cells) {
    if (!cell.screenshot) continue;
    try {
      const file = path.join(dirOf(id), path.basename(cell.screenshot));
      images[cell.screenshot] =
        `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {
      /* a screenshot that was removed: the viewer shows none */
    }
  }
  return {report, images};
};

export const reportFolder = (id: string) => dirOf(id);
