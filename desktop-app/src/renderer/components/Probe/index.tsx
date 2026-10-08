import {IPC_MAIN_CHANNELS} from 'common/constants';
import {
  describeConditions,
  MAX_TEST_CELLS,
  NETWORK_PRESETS,
  type ColorScheme,
  type NetworkPreset,
} from 'common/test-conditions';
import type {TestReport} from 'common/test-report';
import {useCallback, useEffect, useRef, useState} from 'react';
import {openReport} from './reportViewer';
import {setProbeOpen, useProbeOpen} from './store';

interface PageList {
  name: string;
  pages: string[];
}
const MAX_PAGES = 10;

type SchemeChoice = 'default' | ColorScheme;
interface Target {
  name: string;
  id: number;
}

const NETS: NetworkPreset[] = ['none', 'wifi', '4g', '3g-fast', '3g-slow', 'offline'];
const CPUS = [1, 2, 4, 6, 20];
const SCHEMES: SchemeChoice[] = ['default', 'light', 'dark'];
const WIDTH = 320;

const invoke = <R,>(channel: string, ...args: unknown[]) =>
  window.electron.ipcRenderer.invoke<unknown, R>(channel, ...args);

/** The previews that can be measured: Chromium webviews, named like their device. */
const readTargets = (): Target[] =>
  Array.from(document.querySelectorAll<Electron.WebviewTag>('webview')).flatMap((el) => {
    try {
      return [{name: el.id, id: el.getWebContentsId()}];
    } catch {
      return [];
    }
  });

const Seg = <T extends string | number>({
  label,
  items,
  isOn,
  pick,
  text,
  disabled,
}: {
  label: string;
  items: T[];
  isOn: (item: T) => boolean;
  pick: (item: T) => void;
  text: (item: T) => string;
  disabled?: boolean;
}) => (
  <div role="group" aria-label={label} className="mt-3">
    <div className="mb-[6px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
      {label}
    </div>
    <div className="flex flex-wrap gap-[2px] rounded-lg border border-line p-[2px]">
      {items.map((item) => (
        <button
          key={String(item)}
          type="button"
          disabled={disabled}
          aria-pressed={isOn(item)}
          onClick={() => pick(item)}
          className={`h-[26px] rounded-md px-[9px] text-[11.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 ${
            isOn(item) ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
          }`}
        >
          {text(item)}
        </button>
      ))}
    </div>
  </div>
);

const ProbePanel = () => {
  const open = useProbeOpen();
  const [targets, setTargets] = useState<Target[]>([]);
  const [plug, setPlug] = useState<string | null>(null);
  const [nets, setNets] = useState<NetworkPreset[]>(['4g']);
  const [cpus, setCpus] = useState<number[]>([1]);
  const [schemes, setSchemes] = useState<SchemeChoice[]>(['default']);
  const [matrix, setMatrix] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<TestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const [pos, setPos] = useState<{x: number; y: number}>({x: 0, y: 0});
  const [floating, setFloating] = useState<{x: number; y: number} | null>(null);
  const plugged = useRef<Target | null>(null);
  const [lists, setLists] = useState<PageList[]>(
    () => (window.electron.store.get('testProbe.pageLists') as PageList[] | undefined) ?? []
  );
  const [listName, setListName] = useState<string | null>(null);
  const [editing, setEditing] = useState<{name: string; text: string} | null>(null);
  const [askFirst, setAskFirst] = useState<boolean>(
    () => window.electron.store.get('testProbe.askFirst') === true
  );
  const pages = lists.find((l) => l.name === listName)?.pages;
  const saveLists = (next: PageList[]) => {
    setLists(next);
    window.electron.store.set('testProbe.pageLists', next);
  };

  // Which previews exist, and where the plugged one is (so the panel can follow it).
  useEffect(() => {
    if (!open) return undefined;
    const tick = () => {
      const found = readTargets();
      setTargets((old) => (JSON.stringify(old) === JSON.stringify(found) ? old : found));
      if (plug) {
        const label = Array.from(document.querySelectorAll('[data-device-label]')).find(
          (el) => el.getAttribute('data-device-label') === plug
        );
        const rect = label?.parentElement?.getBoundingClientRect();
        if (rect) {
          // Beside the device it is plugged into, never over it.
          const right = rect.right + 14;
          const onRight = right + WIDTH <= window.innerWidth - 8;
          const x = onRight ? right : Math.max(8, rect.left - WIDTH - 14);
          const y = Math.max(60, Math.min(rect.top, window.innerHeight - 420));
          setSide(onRight ? 'left' : 'right');
          setPos((old) => (old.x === x && old.y === y ? old : {x, y}));
        }
      }
    };
    tick();
    const timer = setInterval(tick, 300);
    return () => clearInterval(timer);
  }, [open, plug]);

  useEffect(
    () =>
      window.electron.ipcRenderer.on<{running: boolean}>(
        IPC_MAIN_CHANNELS.TEST_RUN_STATE,
        (value) => setRunning(Boolean(value?.running))
      ),
    []
  );

  const target = targets.find((t) => t.name === plug) ?? null;
  const schemeOf = (s: SchemeChoice) => (s === 'default' ? null : s);

  // Plugged and not a matrix: the conditions are live on that device.
  useEffect(() => {
    if (!open || !target || matrix || running) return;
    plugged.current = target;
    invoke(IPC_MAIN_CHANNELS.TEST_CONDITIONS_SET, target.id, {
      network: nets[0],
      cpu: cpus[0],
      scheme: schemeOf(schemes[0]),
    }).catch((e: Error) => setError(e.message));
  }, [open, target?.id, matrix, nets, cpus, schemes, running]); // eslint-disable-line react-hooks/exhaustive-deps

  // A chip cleared on the device's header unplugs the probe too.
  useEffect(
    () =>
      window.electron.ipcRenderer.on<Record<string, string>>(
        IPC_MAIN_CHANNELS.TEST_CONDITIONS,
        (labels) => {
          const was = plugged.current;
          if (was && !(labels && String(was.id) in labels)) {
            plugged.current = null;
            setPlug(null);
          }
        }
      ),
    []
  );

  const release = useCallback(() => {
    const was = plugged.current;
    plugged.current = null;
    return was
      ? invoke(IPC_MAIN_CHANNELS.TEST_CONDITIONS_CLEAR, was.id).catch(() => {})
      : Promise.resolve();
  }, []);

  // A conditions chip cleared from a device header also unplugs.
  const unplug = () => {
    release();
    setPlug(null);
  };
  const close = () => {
    unplug();
    // A fresh start next time: choices, matrix and the last report do not linger.
    setNets(['4g']);
    setCpus([1]);
    setSchemes(['default']);
    setMatrix(false);
    setReport(null);
    setError(null);
    setListName(null);
    setEditing(null);
    setProbeOpen(false);
  };
  useEffect(() => {
    if (!open) release();
  }, [open, release]);

  const choose =
    <T,>(list: T[], set: (v: T[]) => void) =>
    (item: T) => {
      if (!matrix) set([item]);
      else
        set(
          list.includes(item)
            ? list.length > 1
              ? list.filter((x) => x !== item)
              : list
            : [...list, item]
        );
    };

  const deviceCount = plug ? 1 : targets.length;
  const total =
    nets.length * cpus.length * schemes.length * Math.max(deviceCount, 1) * (pages?.length ?? 1);
  const live = plug !== null && !matrix;
  const first = describeConditions({
    network: nets[0],
    cpu: cpus[0],
    scheme: schemeOf(schemes[0]),
  });

  const run = async () => {
    setError(null);
    setReport(null);
    // The conditions must be off before the run takes the preview over.
    await release();
    try {
      const result = await invoke<TestReport>(IPC_MAIN_CHANNELS.TEST_RUN_START, {
        pages,
        devices: plug ? [plug] : targets.map((t) => t.name),
        networks: nets,
        cpus,
        schemes: schemes.map(schemeOf),
      });
      if (result.status === 'failed') setError(result.note ?? 'The test failed.');
      else setReport(result);
    } catch (e) {
      setError(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      );
    }
  };

  const dragStart = (event: React.PointerEvent) => {
    if (plug) return;
    const startX = event.clientX - (floating?.x ?? pos.x);
    const startY = event.clientY - (floating?.y ?? pos.y);
    const move = (e: PointerEvent) => setFloating({x: e.clientX - startX, y: e.clientY - startY});
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!open) return null;
  const home = {x: Math.max(8, window.innerWidth - WIDTH - 24), y: 72};
  const at = plug ? pos : (floating ?? home);

  return (
    <div
      role="dialog"
      aria-label="Test probe"
      data-testid="probe-panel"
      className={`fixed z-40 box-border rounded-[14px] border border-line bg-panel p-[14px] pt-3 text-fg shadow-2xl transition-[left,top] duration-500 ease-out ${
        running ? 'ring-2 ring-accent' : ''
      }`}
      style={{
        left: at.x,
        top: at.y,
        width: WIDTH,
        maxHeight: 'calc(100vh - 90px)',
        overflowY: 'auto',
      }}
    >
      {plug ? (
        <span
          aria-hidden
          className={`absolute top-6 h-9 w-[4px] bg-accent ${
            side === 'left' ? 'left-0 rounded-r-sm' : 'right-0 rounded-l-sm'
          } ${running ? 'animate-pulse' : ''}`}
        />
      ) : null}
      <div
        onPointerDown={dragStart}
        className={`flex items-center gap-2 ${plug ? '' : 'cursor-grab'}`}
      >
        <b className="text-[13px]">Test probe</b>
        <span className="text-[11px] text-muted">{plug ? `plugged into ${plug}` : 'floating'}</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close the probe"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={close}
          className="h-6 w-6 rounded-md text-muted hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          ✕
        </button>
      </div>

      <Seg
        label="Plug into"
        items={['', ...targets.map((t) => t.name)]}
        isOn={(n) => (n || null) === plug}
        pick={(n) => {
          release();
          setPlug(n || null);
        }}
        text={(n) => n || 'Nothing'}
        disabled={running}
      />
      <Seg
        label="Network"
        items={NETS}
        isOn={(n) => nets.includes(n)}
        pick={choose(nets, setNets)}
        text={(n) => NETWORK_PRESETS[n].label}
        disabled={running}
      />
      <Seg
        label="CPU"
        items={CPUS}
        isOn={(c) => cpus.includes(c)}
        pick={choose(cpus, setCpus)}
        text={(c) => `×${c}`}
        disabled={running}
      />
      <Seg
        label="Page colour"
        items={SCHEMES}
        isOn={(s) => schemes.includes(s)}
        pick={choose(schemes, setSchemes)}
        text={(s) => (s === 'default' ? 'Default' : s === 'light' ? 'Light' : 'Dark')}
        disabled={running}
      />

      <Seg
        label="Pages"
        items={['', ...lists.map((l) => l.name)]}
        isOn={(n) => (n || null) === listName}
        pick={(n) => {
          setListName(n || null);
          setEditing(null);
        }}
        text={(n) => n || 'Current page'}
        disabled={running}
      />
      {editing ? (
        <div className="mt-2 rounded-lg border border-line p-2">
          <input
            aria-label="List name"
            value={editing.name}
            onChange={(e) => setEditing({...editing, name: e.target.value})}
            placeholder="Name, for example Checkout"
            className="mb-2 h-7 w-full rounded-md border border-line bg-transparent px-2 text-[12px]"
          />
          <textarea
            aria-label="Pages, one address per line"
            value={editing.text}
            onChange={(e) => setEditing({...editing, text: e.target.value})}
            placeholder={'One address per line (up to ' + MAX_PAGES + ')\nhttp://localhost:3000/'}
            rows={4}
            className="w-full rounded-md border border-line bg-transparent p-2 font-mono text-[11px]"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!editing.name.trim() || !editing.text.trim()}
              onClick={() => {
                const name = editing.name.trim();
                const list = {
                  name,
                  pages: editing.text
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .slice(0, MAX_PAGES),
                };
                saveLists([
                  ...lists.filter((l) => l.name !== (listName ?? name) && l.name !== name),
                  list,
                ]);
                setListName(name);
                setEditing(null);
              }}
              className="h-7 rounded-md bg-accent px-3 text-[12px] font-bold text-black disabled:opacity-50"
            >
              Save list
            </button>
            {listName ? (
              <button
                type="button"
                onClick={() => {
                  saveLists(lists.filter((l) => l.name !== listName));
                  setListName(null);
                  setEditing(null);
                }}
                className="h-7 rounded-md border border-line px-3 text-[12px] hover:bg-hover"
              >
                Delete list
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="h-7 rounded-md border border-line px-3 text-[12px] hover:bg-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={running}
          onClick={() =>
            setEditing(
              pages && listName ? {name: listName, text: pages.join('\n')} : {name: '', text: ''}
            )
          }
          className="mt-2 text-[11.5px] text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {listName ? `Edit ${listName}` : '+ New list of pages'}
        </button>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={matrix}
            disabled={running}
            onChange={() => {
              setMatrix(!matrix);
              setNets(nets.slice(0, 1));
              setCpus(cpus.slice(0, 1));
              setSchemes(schemes.slice(0, 1));
            }}
            className="m-0 accent-accent"
          />
          Try every combination ticked above
        </label>
        <p className="my-2 text-[11.5px] text-muted">
          {live
            ? `${first} is on ${plug} now. Unplug to put it back.`
            : total > MAX_TEST_CELLS
              ? `${total} measurements is over the limit of ${MAX_TEST_CELLS}.`
              : `${total} measurement${total === 1 ? '' : 's'}, one at a time, then a report. The previews are put back afterwards.`}
        </p>
        {live ? null : (
          <button
            type="button"
            disabled={running || total > MAX_TEST_CELLS || targets.length === 0}
            onClick={run}
            className="h-[30px] w-full rounded-lg bg-accent text-[12.5px] font-bold text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-fg disabled:opacity-50"
          >
            {running ? 'Running…' : `Run ${total} measurement${total === 1 ? '' : 's'}`}
          </button>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-[11.5px] text-red-400">
            {error}
          </p>
        ) : null}
      </div>

      <label className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[11.5px] text-muted">
        <input
          type="checkbox"
          checked={askFirst}
          onChange={() => {
            window.electron.store.set('testProbe.askFirst', !askFirst);
            setAskFirst(!askFirst);
          }}
          className="m-0 accent-accent"
        />
        Ask me before an agent runs a test or sets conditions
      </label>

      {report ? (
        <div data-testid="probe-report" className="mt-3 border-t border-line pt-3">
          <div className="mb-1 text-[11.5px]">
            <b>Report {report.id}</b>{' '}
            <span className="text-muted">
              {report.status} · saved in Settings › Storage › Test reports
            </span>
          </div>
          <button
            type="button"
            onClick={() => openReport(report.id)}
            className="mb-2 text-[11.5px] text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Open the full report
          </button>
          <table className="w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-1 font-normal">Device</th>
                <th className="py-1 pr-1 font-normal">Conditions</th>
                <th className="py-1 pr-1 font-normal">Load</th>
                <th className="py-1 font-normal">Errors</th>
              </tr>
            </thead>
            <tbody>
              {report.cells.map((c) => (
                <tr key={c.index} className="border-t border-line">
                  <td className="py-1 pr-1">{c.device.name}</td>
                  <td className="py-1 pr-1">{describeConditions(c.conditions)}</td>
                  <td className="py-1 pr-1">
                    {c.loaded && c.timings.loadMs !== null
                      ? `${Math.round(c.timings.loadMs)} ms`
                      : 'not loaded'}
                  </td>
                  <td className="py-1">{c.console.errors + c.transfer.failed.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

export default ProbePanel;
