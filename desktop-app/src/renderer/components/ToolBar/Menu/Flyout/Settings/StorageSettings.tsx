import cx from 'classnames';
import {AddonSizes, AddonsState, SIX_MONTHS_MS} from 'common/addons';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {IosSimState} from 'common/ios-simulator';
import type {SessionInfo, SessionRequest} from 'common/sessions';
import {useCallback, useEffect, useState} from 'react';
import {addonsRequest, formatSize} from 'renderer/components/Addons';
import {iosSim, runtimeLabel} from 'renderer/components/IosSafari';
import {openReport} from 'renderer/components/Probe/reportViewer';
import SectionCaption from 'renderer/components/SectionCaption';

const btn =
  'h-control-sm whitespace-nowrap rounded-control border px-3 text-small disabled:opacity-50';

const sessionsRequest = <T,>(req: SessionRequest) =>
  window.electron.ipcRenderer.invoke<SessionRequest, T>(IPC_MAIN_CHANNELS.SESSIONS_REQUEST, req);

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});

export const unusedSixMonths = (iso: string | undefined, now = Date.now()) =>
  iso !== undefined && now - Date.parse(iso) > SIX_MONTHS_MS;

export interface StorageRow {
  key: string;
  name: string;
  detail: string;
  bytes: number;
  /** Set only while it can be cleaned up: never for something running. */
  lastUsedAt?: string;
  action: 'Delete' | 'Uninstall' | 'Reset';
  /** Why the action is unavailable now. */
  blocked?: string;
  run: () => Promise<unknown>;
  stop?: () => Promise<unknown>;
  /** An extra, harmless button before the destructive one (opening a report). */
  view?: () => void;
}

interface Data {
  ios: IosSimState | null;
  lib: AddonsState;
  sizes: AddonSizes;
  sessions: SessionInfo[];
  profiles: Record<string, number>;
  reports: {id: string; createdAt: string; status: string; measurements: number; bytes: number}[];
}

const groupsFor = ({ios, lib, sizes, sessions, profiles, reports}: Data) => [
  {
    title: 'iOS versions',
    color: 'bg-chart-1',
    empty: ios?.available
      ? 'None installed. Add one in Xcode › Settings › Components.'
      : (ios?.reason ?? 'Not available on this Mac'),
    rows: (ios?.runtimes ?? []).map((r): StorageRow => ({
      key: r.id,
      name: r.name,
      detail: `Real Safari${r.lastUsedAt ? ` · last used ${day(r.lastUsedAt)}` : ''}`,
      bytes: r.sizeBytes,
      lastUsedAt: r.lastUsedAt,
      action: 'Delete',
      blocked: r.deletable ? undefined : 'Installed with Xcode',
      run: () => iosSim({operation: 'delete-runtime', runtime: r.id}),
    })),
  },
  {
    title: 'Simulators',
    color: 'bg-chart-2',
    empty: 'None yet: pick iOS Safari on a device to make one.',
    rows: (ios?.devices ?? []).map((d): StorageRow => ({
      key: d.udid,
      name: `${d.name} · ${runtimeLabel(d.runtime)}`,
      detail: d.booted ? 'Running' : `Last used ${d.lastUsedAt ? day(d.lastUsedAt) : 'unknown'}`,
      bytes: d.sizeBytes,
      lastUsedAt: d.booted ? undefined : d.lastUsedAt,
      action: 'Delete',
      run: () => iosSim({operation: 'delete-device', udid: d.udid}),
      stop: d.booted ? () => iosSim({operation: 'stop', udid: d.udid}) : undefined,
    })),
  },
  {
    title: 'Add-ons',
    color: 'bg-chart-3',
    empty: 'None installed.',
    rows: lib.addons.map((a): StorageRow => ({
      key: a.id,
      name: a.name,
      detail: `${a.sourceKind === 'folder' ? 'Your folder, not counted · ' : ''}Last used ${day(a.lastUsedAt)}`,
      bytes: sizes[a.id]?.files ?? 0,
      lastUsedAt: a.lastUsedAt,
      action: 'Uninstall',
      run: () => addonsRequest({operation: 'uninstall', id: a.id}),
    })),
  },
  {
    title: 'Python environments',
    color: 'bg-chart-4',
    empty: 'None: Python add-ons get one when they are built.',
    rows: lib.addons
      .filter((a) => (sizes[a.id]?.env ?? 0) > 0)
      .map((a): StorageRow => ({
        key: `env-${a.id}`,
        name: `${a.name} · ${a.python?.env ?? 'Python'}`,
        detail: 'Made again by its build command',
        bytes: sizes[a.id].env,
        action: 'Delete',
        run: () => addonsRequest({operation: 'delete-env', id: a.id}),
      })),
  },
  {
    title: 'Session profiles',
    color: 'bg-chart-5',
    empty: 'No Sessions yet.',
    rows: sessions.map((s): StorageRow => {
      const stopped = s.status === 'stopped';
      const used = s.lastOpenedAt ?? s.createdAt;
      return {
        key: s.id,
        name: s.name,
        detail: stopped
          ? `Cache, cookies and storage · last opened ${day(used)}`
          : 'Open now: close it to reset its data',
        bytes: profiles[s.id] ?? 0,
        lastUsedAt: stopped ? used : undefined,
        action: 'Reset',
        blocked: stopped ? undefined : 'Open',
        run: () => sessionsRequest({operation: 'reset', id: s.id, confirmed: true}),
      };
    }),
  },
  {
    title: 'Test reports',
    color: 'bg-accent',
    empty: "None yet: an agent's run_test, or a test you start, saves one here.",
    rows: reports.map((r): StorageRow => ({
      key: r.id,
      name: `Report ${r.id}`,
      detail: `${r.measurements} measurement${r.measurements === 1 ? '' : 's'} · ${r.status} · ${day(r.createdAt)} · the latest 20 are kept`,
      bytes: r.bytes,
      action: 'Delete',
      view: () => openReport(r.id),
      run: () => window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.TEST_REPORTS_DELETE, r.id),
    })),
  },
];

/** Two clicks: the first asks, with the size, the second acts. */
const ActionButton = ({row, onRun}: {row: StorageRow; onRun: () => void}) => {
  const [asking, setAsking] = useState(false);
  return (
    <button
      type="button"
      disabled={row.blocked !== undefined}
      title={row.blocked}
      aria-label={asking ? undefined : `${row.action} ${row.name}`}
      onClick={() => (asking ? onRun() : setAsking(true))}
      onBlur={() => setAsking(false)}
      className={cx(btn, 'border-danger text-danger hover:bg-hover')}
    >
      {asking ? `${row.action} ${formatSize(row.bytes)}?` : row.action}
    </button>
  );
};

/**
 * Settings › Storage: everything Responsively keeps on this Mac (iOS versions,
 * Simulators, add-ons, their Python environments, Session profiles), with the
 * offer to clean up what nobody used for six months.
 */
export const StorageSettings = () => {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmStale, setConfirmStale] = useState(false);

  // Each source on its own: one that doesn't answer (no Xcode, no Sessions
  // controller) leaves its group empty instead of hiding the page.
  const refresh = useCallback(() => {
    const read = <T,>(ask: () => Promise<T> | undefined, fallback: T) =>
      Promise.resolve()
        .then(ask)
        .then((value) => value ?? fallback)
        .catch(() => fallback);
    Promise.all([
      read(() => iosSim<IosSimState>({operation: 'list'}), null),
      read(() => addonsRequest<AddonsState>({operation: 'state'}), {
        addons: [],
        stacks: [],
        stackId: 'default',
        autoCleanup: false,
      }),
      read(() => addonsRequest<AddonSizes>({operation: 'sizes'}), {}),
      read(() => sessionsRequest<SessionInfo[]>({operation: 'list'}), []),
      read(
        () =>
          window.electron.ipcRenderer.invoke<undefined, Record<string, number>>(
            IPC_MAIN_CHANNELS.SESSION_PROFILE_SIZES
          ),
        {}
      ),
      read(
        () =>
          window.electron.ipcRenderer.invoke<undefined, Data['reports']>(
            IPC_MAIN_CHANNELS.TEST_REPORTS_LIST
          ),
        []
      ),
    ])
      .then(([ios, lib, sizes, sessions, profiles, reports]) =>
        setData({
          ios,
          lib,
          sizes,
          sessions: Array.isArray(sessions) ? sessions : [],
          profiles,
          reports: Array.isArray(reports) ? reports : [],
        })
      )
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const act = async (work: (() => Promise<unknown>)[]) => {
    setBusy(true);
    setError('');
    try {
      for (const run of work) await run();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method[^:]*: /, '')
          : String(e)
      );
    } finally {
      setBusy(false);
      setConfirmStale(false);
      refresh();
    }
  };

  if (data === null) return <p className="my-4 text-body text-muted">Measuring…</p>;

  const groups = groupsFor(data);
  const sum = (rows: StorageRow[]) => rows.reduce((a, r) => a + r.bytes, 0);
  const total = groups.reduce((a, g) => a + sum(g.rows), 0);
  const cleanup = data.lib.autoCleanup;
  const isStale = (r: StorageRow) => cleanup && !r.blocked && unusedSixMonths(r.lastUsedAt);
  const stale = groups.flatMap((g) => g.rows.filter(isStale));

  return (
    <div
      data-testid="settings-storage"
      aria-busy={busy}
      className="my-4 flex flex-col gap-3 text-body"
    >
      <p className="m-0 text-muted">
        Everything Responsively keeps on this Mac for previews and add-ons. Nothing is deleted
        without asking.
      </p>
      <div className="flex items-baseline gap-2">
        <span className="text-heading font-bold tabular-nums">{formatSize(total)}</span>
        <span className="text-muted">on disk</span>
      </div>
      <div className="flex h-[10px] overflow-hidden rounded-full bg-line-soft" aria-hidden>
        {groups.map((g) => (
          <span
            key={g.title}
            className={g.color}
            style={{width: total ? `${(sum(g.rows) / total) * 100}%` : 0}}
          />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-[14px] gap-y-1 p-0 text-small text-muted">
        {groups.map((g) => (
          <li key={g.title} className="flex items-center gap-[6px]">
            <span className={cx('h-[10px] w-[10px] rounded-[3px]', g.color)} />
            {g.title} · {formatSize(sum(g.rows))}
          </li>
        ))}
      </ul>

      {stale.length > 0 ? (
        <div
          role="status"
          className="flex items-center gap-[10px] rounded-card border border-warning px-3 py-[10px]"
        >
          <span className="flex-1">
            {stale.length} unused for 6 months · {formatSize(sum(stale))} (
            {stale.map((r) => r.name).join(', ')})
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmStale ? act(stale.map((r) => r.run)) : setConfirmStale(true))}
            onBlur={() => setConfirmStale(false)}
            className={cx(btn, 'border-danger text-danger hover:bg-hover')}
          >
            {confirmStale ? `Clean up ${formatSize(sum(stale))}?` : 'Clean up'}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      ) : null}

      {groups.map((g) => (
        <section
          key={g.title}
          className="rounded-card border border-line bg-card"
          aria-label={g.title}
        >
          <div className="flex items-center gap-2 px-3 pb-2 pt-[10px]">
            <span className={cx('h-[10px] w-[10px] rounded-[3px]', g.color)} />
            <SectionCaption className="flex-1">{g.title}</SectionCaption>
            <span className="text-small tabular-nums text-muted">{formatSize(sum(g.rows))}</span>
          </div>
          {g.rows.length === 0 ? (
            <div className="border-t border-line-soft px-3 py-[10px] text-muted">{g.empty}</div>
          ) : null}
          {g.rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-[10px] border-t border-line-soft px-3 py-[10px]"
            >
              <span className="min-w-0 flex-1">
                {r.name}
                {isStale(r) ? (
                  <span className="ml-2 rounded-full border border-warning px-[7px] text-caption text-warning">
                    Unused 6 months
                  </span>
                ) : null}
                <span className="block text-small text-muted">{r.detail}</span>
              </span>
              <span className="min-w-[64px] text-right tabular-nums">{formatSize(r.bytes)}</span>
              {r.stop ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act([r.stop!])}
                  className={cx(btn, 'border-line text-fg hover:bg-hover')}
                >
                  Stop
                </button>
              ) : null}
              {r.view ? (
                <button
                  type="button"
                  aria-label={`View ${r.name}`}
                  onClick={r.view}
                  className={cx(btn, 'border-line text-fg hover:bg-hover')}
                >
                  View
                </button>
              ) : null}
              <ActionButton row={r} onRun={() => act([r.run])} />
            </div>
          ))}
        </section>
      ))}

      <label className="flex items-center gap-[10px]">
        <span className="flex-1">
          Offer to clean up anything unused for 6 months
          <span className="block text-small text-muted">
            iOS versions, Simulators, add-ons and Session profiles. You always confirm; their data
            goes too.
          </span>
        </span>
        <input
          type="checkbox"
          checked={cleanup}
          onChange={(e) =>
            act([() => addonsRequest({operation: 'set-auto-cleanup', on: e.target.checked})])
          }
          className="h-4 w-4 accent-accent"
        />
      </label>
    </div>
  );
};
