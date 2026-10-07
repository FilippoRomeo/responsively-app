import {Dialog, DialogPanel, DialogTitle} from '@headlessui/react';
import {Icon} from '@iconify/react';
import cx from 'classnames';
import {Addon, AddonLog, AddonPart, AddonsRequest, AddonsState, partOn} from 'common/addons';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useCallback, useEffect, useRef, useState} from 'react';
import useOverlayRegistry from 'renderer/hooks/useOverlayRegistry';

export const addonsRequest = <T,>(req: AddonsRequest) =>
  window.electron.ipcRenderer.invoke<AddonsRequest, T>(IPC_MAIN_CHANNELS.ADDONS, req);

/** The shared add-on library and this window's stack, kept fresh. */
export const useAddons = () => {
  const [state, setState] = useState<AddonsState | null>(null);
  const refresh = useCallback(() => {
    Promise.resolve(addonsRequest<AddonsState>({operation: 'state'}))
      .then((value) => value && setState(value))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    return window.electron.ipcRenderer.on(IPC_MAIN_CHANNELS.ADDONS_CHANGED, refresh);
  }, [refresh]);
  return {state, refresh};
};

const formatSize = (bytes: number) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
};

const KIND: Record<AddonPart['kind'], string> = {
  panel: 'App panel',
  script: 'Page script',
  start: 'Start command',
};

const partDetail = (part: AddonPart) => {
  if (part.kind === 'panel') return `${part.url} · its own tab beside the previews`;
  if (part.kind === 'script') return `${part.file} · runs on ${part.matches.join(', ')}`;
  return `Runs "${part.command}" while this window is open`;
};

const btn =
  'h-[30px] whitespace-nowrap rounded-[7px] border border-line px-3 text-[12.5px] text-fg hover:bg-hover disabled:opacity-50';
const primary =
  'h-[30px] whitespace-nowrap rounded-[7px] bg-accent px-3 text-[12.5px] font-bold text-on-accent disabled:opacity-50';

const Switch = ({on, label, onChange}: {on: boolean; label: string; onChange: () => void}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={onChange}
    className={cx(
      'relative h-[18px] w-8 shrink-0 rounded-full transition-colors',
      on ? 'bg-accent' : 'bg-line'
    )}
  >
    <span
      className={cx(
        'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-[left]',
        on ? 'left-4' : 'left-[2px]'
      )}
    />
  </button>
);

/** Streams one build command's output; `onDone` gets its exit code. */
const Terminal = ({runId, onDone}: {runId: string; onDone: (code: number | null) => void}) => {
  const [text, setText] = useState('');
  const box = useRef<HTMLPreElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(
    () =>
      window.electron.ipcRenderer.on<AddonLog>(IPC_MAIN_CHANNELS.ADDONS_LOG, (entry) => {
        if (entry.runId !== runId) return;
        setText((t) => (t + entry.text).slice(-20000));
        if (entry.done) done.current(entry.code ?? null);
      }),
    [runId]
  );
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [text]);
  return (
    <pre
      ref={box}
      data-testid="addon-terminal"
      className="m-0 h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-[#05080e] p-2 font-mono text-[11px] text-[#c7d0dc]"
    >
      {text || '…'}
    </pre>
  );
};

/** Source → what it adds (editable, with an optional build) → permission. */
const Install = ({onDone}: {onDone: () => void}) => {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addon, setAddon] = useState<Addon | null>(null);
  const [run, setRun] = useState<{runId: string; code?: number | null} | null>(null);

  const look = async () => {
    setBusy(true);
    setError('');
    try {
      setAddon(await addonsRequest<Addon>({operation: 'inspect', source}));
      setStep(1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method[^:]*: /, '')
          : String(e)
      );
    } finally {
      setBusy(false);
    }
  };
  const setPart = (index: number, part: AddonPart) =>
    setAddon((a) => a && {...a, parts: a.parts.map((p, i) => (i === index ? part : p))});
  const addPart = (kind: AddonPart['kind']) =>
    setAddon(
      (a) =>
        a && {
          ...a,
          parts: [
            ...a.parts,
            kind === 'script'
              ? {
                  id: `script-${a.parts.length}`,
                  kind,
                  label: 'Page script',
                  file: 'dist/index.js',
                  matches: ['localhost:*'],
                }
              : kind === 'panel'
                ? {
                    id: `panel-${a.parts.length}`,
                    kind,
                    label: 'Panel',
                    url: 'http://127.0.0.1:8188/',
                  }
                : {id: `start-${a.parts.length}`, kind, label: 'Start command', command: ''},
          ],
        }
    );
  const cancel = () => {
    if (addon?.dir && step > 0 && addon.sourceKind !== 'folder' && addon.sourceKind !== 'url')
      addonsRequest({operation: 'cancel-install', id: addon.id}).catch(() => {});
    onDone();
  };
  const runBuild = async () => {
    if (!addon?.buildCommand) return;
    setError('');
    try {
      const {runId} = await addonsRequest<{runId: string}>({
        operation: 'run',
        id: addon.id,
        command: addon.buildCommand,
        dir: addon.dir,
      });
      setRun({runId});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const install = async () => {
    setBusy(true);
    try {
      await addonsRequest({operation: 'install', addon: addon!});
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const steps = ['Source', 'What it adds', 'Allow'];
  return (
    <div data-testid="addon-install" className="flex flex-col gap-4 p-5">
      <div className="flex gap-4">
        {steps.map((label, i) => (
          <span
            key={label}
            className={cx(
              'flex items-center gap-[6px] text-[12px]',
              i === step ? 'text-fg' : 'text-muted'
            )}
          >
            <span
              className={cx(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold',
                i <= step ? 'bg-accent text-on-accent' : 'bg-line text-muted'
              )}
            >
              {i + 1}
            </span>
            {label}
          </span>
        ))}
      </div>

      {step === 0 ? (
        <>
          <label htmlFor="addon-source" className="text-[13px]">
            Where is it?
          </label>
          <input
            id="addon-source"
            data-testid="addon-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && source && look()}
            placeholder="github.com/owner/repo · npm:package · http://127.0.0.1:8188 · /path/to/folder"
            className="h-9 rounded-lg border border-line bg-card px-3 font-mono text-[12.5px] text-fg"
          />
          <p className="m-0 text-[11.5px] leading-relaxed text-muted">
            Responsively uses it as it is and shows what it found — nothing to convert.
          </p>
        </>
      ) : null}

      {step === 1 && addon ? (
        <>
          <div className="text-[13px]">
            Found <b>{addon.name}</b>{' '}
            <span className="text-muted">— {addon.about || addon.source}</span>
          </div>
          <div className="flex flex-col rounded-[10px] border border-line bg-card">
            {addon.parts.length === 0 ? (
              <div className="px-3 py-[10px] text-[12.5px] text-muted">
                Nothing ready to use yet — build it, or add a part below.
              </div>
            ) : null}
            {addon.parts.map((part, i) => (
              <div
                key={part.id}
                className="flex flex-col gap-2 border-t border-line-soft px-3 py-[10px] first:border-t-0"
              >
                <div className="flex items-center gap-2 text-[13px] font-bold">
                  {KIND[part.kind]}
                  <span className="flex-1" />
                  <button
                    type="button"
                    className="text-[11.5px] font-normal text-muted hover:text-fg"
                    onClick={() =>
                      setAddon({...addon, parts: addon.parts.filter((_, j) => j !== i)})
                    }
                  >
                    Remove
                  </button>
                </div>
                {part.kind === 'panel' ? (
                  <input
                    aria-label="Panel address"
                    value={part.url}
                    onChange={(e) => setPart(i, {...part, url: e.target.value})}
                    className="h-8 rounded-md border border-line bg-panel px-2 font-mono text-[12px]"
                  />
                ) : null}
                {part.kind === 'script' ? (
                  <div className="flex gap-2">
                    <input
                      aria-label="Script file"
                      value={part.file}
                      onChange={(e) => setPart(i, {...part, file: e.target.value})}
                      className="h-8 flex-1 rounded-md border border-line bg-panel px-2 font-mono text-[12px]"
                    />
                    <select
                      aria-label="When it runs"
                      value={part.when ?? 'ready'}
                      onChange={(e) =>
                        setPart(i, {...part, when: e.target.value as 'ready' | 'start'})
                      }
                      className="h-8 rounded-md border border-line bg-panel px-2 text-[12px]"
                    >
                      <option value="ready">When the page is ready</option>
                      <option value="start">Before the page&apos;s scripts</option>
                    </select>
                    <input
                      aria-label="Then run"
                      placeholder="then run, e.g. eruda.init()"
                      value={part.init ?? ''}
                      onChange={(e) => setPart(i, {...part, init: e.target.value || undefined})}
                      className="h-8 w-48 rounded-md border border-line bg-panel px-2 font-mono text-[12px]"
                    />
                    <input
                      aria-label="Runs on sites"
                      value={part.matches.join(', ')}
                      onChange={(e) =>
                        setPart(i, {
                          ...part,
                          matches: e.target.value
                            .split(',')
                            .map((m) => m.trim())
                            .filter(Boolean),
                        })
                      }
                      className="h-8 w-44 rounded-md border border-line bg-panel px-2 font-mono text-[12px]"
                    />
                  </div>
                ) : null}
                {part.kind === 'start' ? (
                  <input
                    aria-label="Start command"
                    value={part.command}
                    placeholder="python main.py"
                    onChange={(e) => setPart(i, {...part, command: e.target.value})}
                    className="h-8 rounded-md border border-line bg-panel px-2 font-mono text-[12px]"
                  />
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => addPart('script')}>
              + Page script
            </button>
            <button type="button" className={btn} onClick={() => addPart('panel')}>
              + App panel
            </button>
            <button type="button" className={btn} onClick={() => addPart('start')}>
              + Start command
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="addon-build" className="text-[12.5px] text-muted">
              Build command (run in its folder; for Python, set up its environment here — conda or
              venv)
            </label>
            <div className="flex gap-2">
              <input
                id="addon-build"
                value={addon.buildCommand ?? ''}
                placeholder="npm install && npm run build"
                onChange={(e) => setAddon({...addon, buildCommand: e.target.value || undefined})}
                className="h-8 flex-1 rounded-md border border-line bg-card px-2 font-mono text-[12px]"
              />
              <button
                type="button"
                className={btn}
                disabled={!addon.buildCommand || (run !== null && run.code === undefined)}
                onClick={runBuild}
              >
                Run
              </button>
            </div>
            {run ? (
              <Terminal runId={run.runId} onDone={(code) => setRun((r) => r && {...r, code})} />
            ) : null}
            {run && run.code !== undefined ? (
              <span className={cx('text-[12px]', run.code === 0 ? 'text-accent' : 'text-red-400')}>
                {run.code === 0 ? 'Built.' : `Stopped with code ${run.code}.`}
              </span>
            ) : null}
          </div>
        </>
      ) : null}

      {step === 2 && addon ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-[10px] border border-amber-400/60 bg-amber-400/5 p-3">
            <div className="text-[13.5px] font-bold">{addon.name} will be able to</div>
            <ul className="mb-0 mt-2 pl-5 text-[12.5px] leading-7">
              {addon.parts.map((p) => (
                <li key={p.id}>
                  {p.kind === 'panel' ? `Show ${p.url} inside Responsively` : null}
                  {p.kind === 'script'
                    ? `Run its code in previews on ${p.matches.join(', ')}`
                    : null}
                  {p.kind === 'start'
                    ? `Run "${p.command}" on this Mac while a window uses it`
                    : null}
                </li>
              ))}
              {addon.buildCommand ? <li>Keep its build command: {addon.buildCommand}</li> : null}
            </ul>
            <div className="mt-2 text-[11.5px] text-muted">
              From {addon.source}. It joins this window&apos;s stack, switched on.
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-[12.5px] text-red-400">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={btn}
          onClick={step === 0 ? cancel : () => setStep(step - 1)}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {step === 0 ? (
          <button type="button" className={primary} disabled={!source || busy} onClick={look}>
            {busy ? 'Looking…' : 'Look inside'}
          </button>
        ) : null}
        {step === 1 ? (
          <button
            type="button"
            className={primary}
            disabled={!addon || addon.parts.length === 0}
            onClick={() => setStep(2)}
          >
            Continue
          </button>
        ) : null}
        {step === 2 ? (
          <button type="button" className={primary} disabled={busy} onClick={install}>
            Allow and install
          </button>
        ) : null}
      </div>
    </div>
  );
};

/** The add-ons manager: each add-on and part switchable per stack, stacks, storage. */
const Manager = ({state, onClose}: {state: AddonsState; onClose: () => void}) => {
  const [selected, setSelected] = useState<string | undefined>(state.addons[0]?.id);
  const [installing, setInstalling] = useState(state.addons.length === 0);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [stale, setStale] = useState<Addon[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const stack = state.stacks.find((s) => s.id === state.stackId);
  const addon = state.addons.find((a) => a.id === selected) ?? state.addons[0];
  const enabled = Boolean(addon && stack?.addons[addon.id]?.enabled);

  useEffect(() => {
    addonsRequest<Record<string, number>>({operation: 'sizes'})
      .then(setSizes)
      .catch(() => {});
    addonsRequest<Addon[]>({operation: 'stale'})
      .then(setStale)
      .catch(() => {});
  }, [state.addons.length]);
  useEffect(() => setConfirm(false), [addon?.id]);

  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
        <DialogTitle className="m-0 text-[15px] font-bold">Add-ons</DialogTitle>
        <span className="flex-1" />
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Stack</span>
        {naming === null ? (
          <>
            <select
              aria-label="Stack for this window"
              value={state.stackId}
              onChange={(e) => addonsRequest({operation: 'use-stack', stackId: e.target.value})}
              className="h-[30px] rounded-[7px] border border-line bg-card px-2 text-[12.5px] font-bold text-fg"
            >
              {state.stacks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={() => setNaming('')}>
              Save as stack…
            </button>
          </>
        ) : (
          <>
            <input
              aria-label="New stack name"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              placeholder="Web 3D dev"
              className="h-[30px] w-40 rounded-[7px] border border-line bg-card px-2 text-[12.5px]"
            />
            <button
              type="button"
              className={primary}
              disabled={!naming.trim()}
              onClick={() => {
                addonsRequest({operation: 'save-stack', name: naming.trim()}).catch(() => {});
                setNaming(null);
              }}
            >
              Save
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <Icon icon="lucide:x" />
        </button>
      </div>

      {stale.length > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-amber-400/5 px-4 py-2 text-[12.5px]"
        >
          <Icon icon="lucide:clock" className="text-amber-400" />
          <span className="flex-1">
            Not used for six months: {stale.map((a) => a.name).join(', ')}. Delete them and their
            data?
          </span>
          <button
            type="button"
            className={btn}
            onClick={() =>
              stale.forEach((a) => addonsRequest({operation: 'keep', id: a.id}).catch(() => {}))
            }
          >
            Keep
          </button>
          <button
            type="button"
            className={cx(btn, 'border-red-500 text-red-400')}
            onClick={() =>
              stale.forEach((a) =>
                addonsRequest({operation: 'uninstall', id: a.id}).catch(() => {})
              )
            }
          >
            Delete
          </button>
        </div>
      ) : null}

      {installing ? (
        <Install onDone={() => setInstalling(false)} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[300px] shrink-0 flex-col gap-[2px] overflow-y-auto border-r border-line-soft p-2">
            {state.addons.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a.id)}
                className={cx(
                  'flex w-full items-center gap-[10px] rounded-lg px-[10px] py-[9px] text-left',
                  a.id === addon?.id ? 'bg-hover' : 'hover:bg-hover'
                )}
              >
                <span
                  className={cx(
                    'h-2 w-2 shrink-0 rounded-full',
                    stack?.addons[a.id]?.enabled ? 'bg-accent' : 'bg-line'
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">{a.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">{a.source}</span>
                </span>
              </button>
            ))}
            <span className="flex-1" />
            <button
              type="button"
              className={cx(primary, 'h-[34px]')}
              onClick={() => setInstalling(true)}
            >
              + Install add-on
            </button>
            <div className="px-1 pt-2 text-[11px] text-muted">
              {formatSize(total)} on disk ·{' '}
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={state.autoCleanup}
                  onChange={(e) =>
                    addonsRequest({operation: 'set-auto-cleanup', on: e.target.checked})
                  }
                />
                offer to delete add-ons unused for 6 months
              </label>
            </div>
          </div>

          {addon ? (
            <div
              data-testid="addon-detail"
              className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] font-bold">{addon.name}</div>
                  <div className="mt-1 truncate font-mono text-[11.5px] text-muted">
                    {addon.source}
                  </div>
                  {addon.about ? (
                    <div className="mt-2 text-[12.5px] text-muted">{addon.about}</div>
                  ) : null}
                </div>
                <Switch
                  on={enabled}
                  label={`${addon.name} on in this stack`}
                  onChange={() =>
                    addonsRequest({operation: 'set-enabled', addonId: addon.id, enabled: !enabled})
                  }
                />
              </div>
              <div
                className={cx('rounded-[10px] border border-line bg-card', {
                  'opacity-50': !enabled,
                })}
              >
                <div className="px-3 pb-2 pt-[10px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                  What it adds — switch each part
                </div>
                {addon.parts.map((part) => {
                  const on = partOn(stack, addon.id, part.id);
                  return (
                    <div
                      key={part.id}
                      className="flex items-center gap-3 border-t border-line-soft px-3 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold">{KIND[part.kind]}</span>
                        <span className="block truncate text-[11.5px] text-muted">
                          {partDetail(part)}
                        </span>
                      </span>
                      <Switch
                        on={on}
                        label={`${KIND[part.kind]} on`}
                        onChange={() =>
                          enabled &&
                          addonsRequest({
                            operation: 'set-part',
                            addonId: addon.id,
                            partId: part.id,
                            on: !on,
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
              <div className="rounded-[10px] border border-line bg-card">
                <div className="px-3 pb-2 pt-[10px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                  Allowed when you installed it
                </div>
                {addon.permissions.map((p) => (
                  <div
                    key={p}
                    className="flex items-center gap-2 border-t border-line-soft px-3 py-2 text-[12.5px]"
                  >
                    <Icon icon="lucide:shield-check" className="text-muted" />
                    {p}
                  </div>
                ))}
                <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
                  <span className="flex-1 text-[11.5px] text-muted">
                    {sizes[addon.id] ? `${formatSize(sizes[addon.id])} · ` : ''}last used{' '}
                    {new Date(addon.lastUsedAt).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    className={cx(btn, 'border-red-500 text-red-400')}
                    onClick={() =>
                      confirm
                        ? addonsRequest({operation: 'uninstall', id: addon.id}).catch(() => {})
                        : setConfirm(true)
                    }
                  >
                    {confirm ? 'Uninstall, with its data?' : 'Uninstall'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
};

/** Toolbar button: this window's stack and how many add-ons are on. */
export const AddonsButton = () => {
  const {state} = useAddons();
  const [open, setOpen] = useState(false);
  useOverlayRegistry(open);
  const stack = state?.stacks.find((s) => s.id === state.stackId);
  const on = Object.values(stack?.addons ?? {}).filter((a) => a.enabled).length;
  return (
    <>
      <button
        type="button"
        title="Add-ons"
        data-testid="addons-button"
        onClick={() => setOpen(true)}
        className={cx(
          'flex h-[30px] items-center gap-[7px] rounded-[9px] border px-[11px] text-[12.5px]',
          on > 0
            ? 'border-accent bg-accent-soft font-bold text-accent'
            : 'border-line text-fg hover:bg-hover'
        )}
      >
        <span className="pointer-events-none contents">
          <Icon icon="lucide:puzzle" fontSize={15} />
          {stack && stack.id !== 'default' ? stack.name : 'Add-ons'}
          {on > 0 ? <span className="text-[11px] font-normal">{on} on</span> : null}
        </span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-6">
          <DialogPanel className="flex h-[min(700px,90vh)] w-[min(1060px,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel text-fg shadow-elevated">
            {state ? <Manager state={state} onClose={() => setOpen(false)} /> : null}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
};

/** App panels of this window's stack, docked right in tabs. */
export const AddonDock = () => {
  const {state} = useAddons();
  const [tab, setTab] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const stack = state?.stacks.find((s) => s.id === state.stackId);
  const panels = (state?.addons ?? []).flatMap((addon) =>
    addon.parts
      .filter((p): p is Extract<AddonPart, {kind: 'panel'}> => p.kind === 'panel')
      .filter((p) => partOn(stack, addon.id, p.id))
      .map((p) => ({key: `${addon.id}:${p.id}`, addon, part: p}))
  );
  if (panels.length === 0) return null;
  const active = panels.find((p) => p.key === tab) ?? panels[0];
  if (hidden)
    return (
      <button
        type="button"
        title="Show add-on panels"
        onClick={() => setHidden(false)}
        className="flex w-7 shrink-0 items-start justify-center border-l border-line-soft bg-panel pt-3 text-muted hover:text-fg"
      >
        <Icon icon="lucide:panel-right-open" />
      </button>
    );
  return (
    <div
      data-testid="addon-dock"
      className="flex w-[520px] shrink-0 flex-col border-l border-line-soft bg-panel"
    >
      <div className="flex items-center gap-1 border-b border-line-soft px-2 py-[6px]">
        {panels.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setTab(p.key)}
            className={cx(
              'h-[30px] rounded-[7px] px-3 text-[12.5px]',
              p.key === active.key ? 'bg-hover font-bold text-fg' : 'text-muted hover:text-fg'
            )}
          >
            {p.addon.name}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          title="Hide panels"
          onClick={() => setHidden(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <Icon icon="lucide:panel-right-close" />
        </button>
      </div>
      {/* Every panel stays mounted (its app keeps state); only the active one shows. */}
      {panels.map((p) => (
        <webview
          key={p.key}
          src={p.part.url}
          /* eslint-disable-next-line react/no-unknown-property */
          partition={`persist:addon-${p.addon.id}`}
          className={cx('min-h-0 flex-1 bg-white', {hidden: p.key !== active.key})}
        />
      ))}
    </div>
  );
};
