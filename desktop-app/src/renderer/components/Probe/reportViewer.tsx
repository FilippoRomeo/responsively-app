import {IPC_MAIN_CHANNELS} from 'common/constants';
import {describeConditions} from 'common/test-conditions';
import type {TestReport} from 'common/test-report';
import {useEffect, useState, useSyncExternalStore} from 'react';

/** Which report the viewer shows (null: closed). Shared by Storage and the probe panel. */
let current: string | null = null;
const listeners = new Set<() => void>();
export const openReport = (id: string | null) => {
  current = id;
  listeners.forEach((l) => l());
};
const useCurrent = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );

const ms = (v: number | null) => (v === null ? '–' : `${Math.round(v)} ms`);
const mb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1000)} KB`);

const ReportViewer = () => {
  const id = useCurrent();
  const [data, setData] = useState<{report: TestReport; images: Record<string, string>} | null>(
    null
  );
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    if (!id) return;
    window.electron.ipcRenderer
      .invoke<unknown, {report: TestReport; images: Record<string, string>}>(
        IPC_MAIN_CHANNELS.TEST_REPORT_READ,
        id
      )
      .then(setData)
      .catch(() => setError('This report is gone.'));
  }, [id]);
  useEffect(() => {
    if (!id) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openReport(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  if (!id) return null;
  const report = data?.report;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-label={`Test report ${id}`}
        data-testid="report-viewer"
        className="flex max-h-full w-full max-w-[1100px] flex-col rounded-[14px] border border-line bg-panel text-fg shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <b className="text-[14px]">Test report {id}</b>
          {report ? (
            <span className="text-[12px] text-muted">
              {report.status} · {report.cells.length} measurements · started by {report.startedBy}
            </span>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() =>
              window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.TEST_REPORT_REVEAL, id)
            }
            className="h-7 rounded-[7px] border border-line px-3 text-[12px] hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Show in Finder
          </button>
          <button
            type="button"
            aria-label="Close the report"
            onClick={() => openReport(null)}
            className="h-7 w-7 rounded-md text-muted hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            ✕
          </button>
        </div>
        <div className="overflow-auto px-5 py-4 text-[12px]">
          {error ? <p role="alert">{error}</p> : null}
          {!report && !error ? <p className="text-muted">Loading…</p> : null}
          {report ? (
            <>
              <p className="mb-3 text-muted">
                Measured values only. Network and CPU are throttled by the browser, so absolute
                times are relative to this Mac.
              </p>
              {report.note ? <p className="mb-3">{report.note}</p> : null}
              <table className="w-full border-collapse text-left">
                <thead className="text-muted">
                  <tr>
                    {[
                      '',
                      'Page',
                      'Device',
                      'Conditions',
                      'Load',
                      'LCP',
                      'CLS',
                      'Requests',
                      'Size',
                      'CPU script',
                      'Errors',
                      'Overflow',
                    ].map((h) => (
                      <th key={h} className="px-2 py-1 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.cells.map((c) => {
                    const shot = c.screenshot ? data?.images[c.screenshot] : undefined;
                    const errors = c.console.errors + c.transfer.failed.length;
                    return (
                      <tr key={c.index} className="border-t border-line align-top">
                        <td className="px-2 py-1">
                          {shot ? (
                            <img
                              src={shot}
                              alt={`${c.device.name}, ${describeConditions(c.conditions)}`}
                              className="h-16 w-auto rounded border border-line"
                            />
                          ) : null}
                        </td>
                        <td className="px-2 py-1">{c.page}</td>
                        <td className="px-2 py-1">{c.device.name}</td>
                        <td className="px-2 py-1">{describeConditions(c.conditions)}</td>
                        <td className="px-2 py-1">
                          {c.loaded ? ms(c.timings.loadMs) : 'not loaded'}
                        </td>
                        <td className="px-2 py-1">{ms(c.timings.lcpMs)}</td>
                        <td className="px-2 py-1">
                          {c.timings.cls === null ? '–' : c.timings.cls.toFixed(3)}
                        </td>
                        <td className="px-2 py-1">{c.transfer.requests}</td>
                        <td className="px-2 py-1">{mb(c.transfer.bytes)}</td>
                        <td className="px-2 py-1">{ms(c.cpu.scriptMs)}</td>
                        <td className={`px-2 py-1 ${errors ? 'text-red-400' : ''}`}>{errors}</td>
                        <td className="px-2 py-1">
                          {c.layout.horizontalOverflow === null
                            ? '–'
                            : c.layout.horizontalOverflow
                              ? 'yes'
                              : 'no'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {report.cells.some(
                (c) => c.error || c.console.messages.length > 0 || c.transfer.failed.length > 0
              ) ? (
                <div className="mt-4">
                  <b>Problems seen</b>
                  {report.cells
                    .flatMap((c) => [
                      ...(c.error ? [`${c.device.name}: ${c.error}`] : []),
                      ...c.transfer.failed
                        .slice(0, 5)
                        .map((f) => `${c.device.name}: failed request ${f.url} (${f.error})`),
                      ...c.console.messages
                        .slice(0, 5)
                        .map((m) => `${c.device.name}: console ${m}`),
                    ])
                    .map((line, i) => (
                      <p key={i} className="mt-1 text-muted">
                        {line}
                      </p>
                    ))}
                </div>
              ) : null}
              {report.skipped.length > 0 ? (
                <div className="mt-4">
                  <b>Not measured</b>
                  {report.skipped.map((s) => (
                    <p key={s.device} className="mt-1 text-muted">
                      {s.device}: {s.reason}
                    </p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ReportViewer;
