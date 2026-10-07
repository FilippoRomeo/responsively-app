import {Icon} from '@iconify/react';
import cx from 'classnames';
import {
  Addon,
  AddonLog,
  AddonPart,
  AddonPython,
  AddonSizes,
  AddonsRequest,
  AddonsState,
  partOn,
  PythonEnvKind,
  PythonTools,
  suggestPythonBuild,
} from 'common/addons';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useCallback, useEffect, useId, useRef, useState} from 'react';
import DialogShell from 'renderer/components/DialogShell';
import Field, {inputClass} from 'renderer/components/Field';
import SectionCaption from 'renderer/components/SectionCaption';
import Toggle from 'renderer/components/Toggle';

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

export const formatSize = (bytes: number) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
};

const KIND: Record<AddonPart['kind'], string> = {
  panel: 'App panel',
  script: 'Page script',
  start: 'Start command',
  mcp: 'MCP server',
  rule: 'Rule',
  prompt: 'Prompt',
};

const partDetail = (part: AddonPart) => {
  if (part.kind === 'panel') return `${part.url} · its own tab beside the previews`;
  if (part.kind === 'script') return `${part.file} · runs on ${part.matches.join(', ')}`;
  if (part.kind === 'start') return `Runs "${part.command}" while this window is open`;
  if (part.kind === 'mcp') return `${part.url ?? part.command} · its tools reach your agents`;
  if (part.kind === 'rule')
    return `${part.name} · ${part.mode === 'always' ? 'always given to agents' : 'on demand'}${part.description ? ` — ${part.description}` : ''}`;
  return `${part.name}${part.description ? ` — ${part.description}` : ''}`;
};

const btn =
  'h-control whitespace-nowrap rounded-control border border-line px-3 text-body text-fg hover:bg-hover disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent';
const primary =
  'h-control whitespace-nowrap rounded-control bg-accent px-3 text-body font-bold text-on-accent disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-panel';
const danger =
  'h-control whitespace-nowrap rounded-control border border-danger px-3 text-body text-danger hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-danger';
const mono = cx(inputClass, 'font-mono text-small');

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
    // Focusable so keyboard users can scroll a long log (WCAG 2.1.1).
    <pre
      ref={box}
      role="log"
      aria-label="Build output"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      data-testid="addon-terminal"
      className="m-0 h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-input p-2 font-mono text-small text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {text || '…'}
    </pre>
  );
};

const STEPS = ['Source', 'What it adds', 'Allow'];

const Steps = ({step}: {step: number}) => (
  <ol className="m-0 flex list-none gap-4 p-0">
    {STEPS.map((label, i) => (
      <li
        key={label}
        aria-current={i === step ? 'step' : undefined}
        className={cx(
          'flex items-center gap-[6px] text-small',
          i === step ? 'font-bold text-fg' : 'text-muted'
        )}
      >
        <span
          className={cx(
            'flex h-5 w-5 items-center justify-center rounded-full text-caption font-bold',
            i < step && 'bg-accent text-on-accent',
            i === step && 'border-2 border-accent text-accent',
            i > step && 'border border-line text-muted'
          )}
        >
          {i < step ? <Icon icon="lucide:check" fontSize={12} /> : i + 1}
        </span>
        {label}
      </li>
    ))}
  </ol>
);

/** One part of an add-on being installed, with visible labelled fields. */
const PartEditor = ({
  part,
  onChange,
  onRemove,
}: {
  part: AddonPart;
  onChange: (part: AddonPart) => void;
  onRemove: () => void;
}) => {
  const [advanced, setAdvanced] = useState(false);
  return (
    <div className="flex flex-col gap-3 border-t border-line-soft px-3 py-3 first:border-t-0">
      <div className="flex items-center gap-2 text-body font-bold">
        {KIND[part.kind]}
        <span className="flex-1" />
        <button
          type="button"
          className="text-small font-normal text-muted hover:text-fg"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      {part.kind === 'panel' ? (
        <Field label="Panel address" hint="A web app shown in its own tab beside the previews">
          {(control) => (
            <input
              {...control}
              value={part.url}
              onChange={(e) => onChange({...part, url: e.target.value})}
              className={mono}
            />
          )}
        </Field>
      ) : null}
      {part.kind === 'script' ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,220px)] gap-3">
            <Field label="Script file" hint="In the add-on's folder">
              {(control) => (
                <input
                  {...control}
                  value={part.file}
                  onChange={(e) => onChange({...part, file: e.target.value})}
                  className={mono}
                />
              )}
            </Field>
            <Field label="Runs on sites" hint="e.g. localhost:*, *.example.com, *">
              {(control) => (
                <input
                  {...control}
                  value={part.matches.join(', ')}
                  onChange={(e) =>
                    onChange({
                      ...part,
                      matches: e.target.value
                        .split(',')
                        .map((m) => m.trim())
                        .filter(Boolean),
                    })
                  }
                  className={mono}
                />
              )}
            </Field>
          </div>
          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
            className="flex w-fit items-center gap-1 text-small text-muted hover:text-fg"
          >
            <Icon
              icon="lucide:chevron-right"
              className={cx('transition-transform', {'rotate-90': advanced})}
            />
            Advanced: when it runs, a line to run after it loads
          </button>
          {advanced ? (
            <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-3">
              <Field label="When it runs" hint="Hooks such as three.js' need “before”">
                {(control) => (
                  <select
                    {...control}
                    value={part.when ?? 'ready'}
                    onChange={(e) => onChange({...part, when: e.target.value as 'ready' | 'start'})}
                    className={inputClass}
                  >
                    <option value="ready">When the page is ready</option>
                    <option value="start">Before the page&apos;s scripts</option>
                  </select>
                )}
              </Field>
              <Field label="Then run" hint="Optional, e.g. eruda.init()">
                {(control) => (
                  <input
                    {...control}
                    value={part.init ?? ''}
                    onChange={(e) => onChange({...part, init: e.target.value || undefined})}
                    className={mono}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </>
      ) : null}
      {part.kind === 'mcp' ? (
        <Field
          label="MCP server — a command or an http(s) address"
          hint="Agents reach its tools with list_addon_tools and call_addon_tool"
        >
          {(control) => (
            <input
              {...control}
              value={part.url ?? part.command ?? ''}
              placeholder="npx -y some-mcp-server  ·  http://127.0.0.1:8000/mcp"
              onChange={(e) =>
                onChange(
                  /^https?:\/\//i.test(e.target.value)
                    ? {...part, url: e.target.value, command: undefined}
                    : {...part, command: e.target.value, url: undefined}
                )
              }
              className={mono}
            />
          )}
        </Field>
      ) : null}
      {part.kind === 'rule' || part.kind === 'prompt' ? (
        <div className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)] gap-3">
          <Field label={part.kind === 'rule' ? 'Rule name' : 'Prompt name'}>
            {(control) => (
              <input
                {...control}
                value={part.name}
                onChange={(e) => onChange({...part, name: e.target.value})}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Description" hint="Agents see this to decide when it applies">
            {(control) => (
              <input
                {...control}
                value={part.description}
                onChange={(e) => onChange({...part, description: e.target.value})}
                className={inputClass}
              />
            )}
          </Field>
        </div>
      ) : null}
      {part.kind === 'rule' ? (
        <>
          <Field label="Give it to agents">
            {(control) => (
              <select
                {...control}
                value={part.mode}
                onChange={(e) =>
                  onChange({...part, mode: e.target.value as 'always' | 'on-demand'})
                }
                className={cx(inputClass, 'w-fit')}
              >
                <option value="on-demand">
                  On demand — name and description, the rest when asked
                </option>
                <option value="always">Always — in full, for every task</option>
              </select>
            )}
          </Field>
          {part.file ? (
            <p className="m-0 text-small text-muted">Text from {part.file} (SKILL.md format)</p>
          ) : (
            <Field label="Rule" hint="Markdown, like the body of a SKILL.md">
              {(control) => (
                <textarea
                  {...control}
                  rows={5}
                  value={part.body ?? ''}
                  onChange={(e) => onChange({...part, body: e.target.value})}
                  className={cx(inputClass, 'h-auto py-2 font-mono text-small')}
                />
              )}
            </Field>
          )}
        </>
      ) : null}
      {part.kind === 'prompt' ? (
        <Field label="Prompt" hint="What the agent should do when you ask for it">
          {(control) => (
            <textarea
              {...control}
              rows={5}
              value={part.text}
              onChange={(e) => onChange({...part, text: e.target.value})}
              className={cx(inputClass, 'h-auto py-2 text-small')}
            />
          )}
        </Field>
      ) : null}
      {part.kind === 'start' ? (
        <Field label="Start command" hint="Runs on this Mac while a window uses the add-on">
          {(control) => (
            <input
              {...control}
              value={part.command}
              placeholder="python main.py"
              onChange={(e) => onChange({...part, command: e.target.value})}
              className={mono}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
};

const ENVS: {id: PythonEnvKind; name: string; tool?: keyof PythonTools; about: string}[] = [
  {id: 'uv', name: 'uv', tool: 'uv', about: 'A fast virtual environment'},
  {
    id: 'conda',
    name: 'conda',
    tool: 'conda',
    about: 'For packages that need conda, or an environment.yml',
  },
  {id: 'venv', name: 'venv', tool: 'python3', about: 'Plain python3 -m venv, no extra tools'},
  {id: 'none', name: 'None', about: 'Use whatever python your shell finds'},
];

/** The environment a Python add-on runs in; tools this Mac lacks can't be picked. */
const PythonEnv = ({
  python,
  onChange,
}: {
  python: AddonPython;
  onChange: (python: AddonPython) => void;
}) => {
  const id = useId();
  const [tools, setTools] = useState<PythonTools | null>(null);
  useEffect(() => {
    addonsRequest<PythonTools>({operation: 'python-tools'})
      .then(setTools)
      .catch(() => setTools({}));
  }, []);
  return (
    <fieldset className="m-0 flex flex-col rounded-card border border-line bg-card p-0">
      <legend className="sr-only">Python environment</legend>
      <SectionCaption className="px-3 pb-2 pt-[10px]">
        Python environment · {python.file}
      </SectionCaption>
      {ENVS.map((e) => {
        const found = e.tool ? tools?.[e.tool] : undefined;
        const missing = tools !== null && e.tool !== undefined && !found;
        return (
          <div
            key={e.id}
            className={cx(
              'flex items-start gap-[10px] border-t border-line-soft px-3 py-[9px] text-body',
              {'opacity-60': missing, 'bg-hover': python.env === e.id}
            )}
          >
            <input
              id={`${id}-${e.id}`}
              type="radio"
              name="python-env"
              checked={python.env === e.id}
              disabled={missing}
              onChange={() => onChange({...python, env: e.id})}
              className="mt-[3px] accent-accent"
            />
            <label htmlFor={`${id}-${e.id}`} className={cx('flex-1', {'cursor-pointer': !missing})}>
              <b>{e.name}</b>
              <span className="block text-small text-muted">
                {found ? `${found} · ` : ''}
                {missing ? 'Not found on this Mac' : e.about}
              </span>
            </label>
          </div>
        );
      })}
      <p className="m-0 border-t border-line-soft px-3 py-2 text-small text-muted">
        Kept in Responsively&apos;s own folder, not in the add-on&apos;s. Its build, start command
        and MCP server run inside it; Settings › Storage shows its size.
      </p>
    </fieldset>
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
    setAddon((a) => {
      if (!a) return a;
      const id = `${kind}-${a.parts.length}`;
      const fresh: Record<AddonPart['kind'], AddonPart> = {
        script: {
          id,
          kind: 'script',
          label: 'Page script',
          file: 'dist/index.js',
          matches: ['localhost:*'],
        },
        panel: {id, kind: 'panel', label: 'Panel', url: 'http://127.0.0.1:8188/'},
        start: {id, kind: 'start', label: 'Start command', command: ''},
        mcp: {id, kind: 'mcp', label: 'MCP server', command: ''},
        rule: {
          id,
          kind: 'rule',
          label: 'Rule',
          name: '',
          description: '',
          body: '',
          mode: 'on-demand',
        },
        prompt: {id, kind: 'prompt', label: 'Prompt', name: '', description: '', text: ''},
      };
      const part = fresh[kind];
      return {...a, parts: [...a.parts, part]};
    });
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
        python: addon.python,
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
  // Riskiest first: commands on this Mac, then code in pages, then panels.
  const risks = addon
    ? [
        ...addon.parts
          .filter((p): p is Extract<AddonPart, {kind: 'start'}> => p.kind === 'start')
          .map((p) => ({
            high: true,
            text: `Run "${p.command}" on this Mac while a window uses it`,
          })),
        ...addon.parts
          .filter((p): p is Extract<AddonPart, {kind: 'mcp'}> => p.kind === 'mcp')
          .map((p) =>
            p.url
              ? {high: false, text: `Give your agents the tools at ${p.url}`}
              : {
                  high: true,
                  text: `Run "${p.command}" on this Mac and give its tools to your agents`,
                }
          ),
        ...(addon.python && addon.python.env !== 'none'
          ? [
              {
                high: false,
                text: `Make a ${addon.python.env} Python environment for it, kept in Responsively`,
              },
            ]
          : []),
        ...addon.parts
          .filter((p): p is Extract<AddonPart, {kind: 'script'}> => p.kind === 'script')
          .map((p) => ({high: false, text: `Run its code in previews on ${p.matches.join(', ')}`})),
        ...addon.parts
          .filter((p): p is Extract<AddonPart, {kind: 'panel'}> => p.kind === 'panel')
          .map((p) => ({high: false, text: `Show ${p.url} inside Responsively`})),
        ...addon.parts
          .filter((p): p is Extract<AddonPart, {kind: 'rule'}> => p.kind === 'rule')
          .map((p) => ({
            high: false,
            text: `Give your agents the rule "${p.name}"${p.mode === 'always' ? ' with every task' : ''}`,
          })),
        ...addon.parts
          .filter((p): p is Extract<AddonPart, {kind: 'prompt'}> => p.kind === 'prompt')
          .map((p) => ({high: false, text: `Offer your agents the prompt "${p.name}"`})),
      ]
    : [];
  const sourceName =
    addon?.sourceKind === 'folder' ? (addon.dir?.split('/').pop() ?? addon.source) : addon?.source;

  return (
    <div data-testid="addon-install" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <Steps step={step} />

        {step === 0 ? (
          <>
            <Field
              label="Where is it?"
              hint="A web address, a GitHub repo (owner/repo), npm:package, or a folder on this Mac. Used as it is — nothing to convert."
            >
              {(control) => (
                <input
                  {...control}
                  data-testid="addon-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && source && look()}
                  placeholder="github.com/owner/repo"
                  className={cx(mono, 'h-9')}
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-small text-muted">Try:</span>
              {['npm:eruda', 'http://127.0.0.1:8188', 'FilippoRomeo/compose3d'].map((example) => (
                <button
                  key={example}
                  type="button"
                  className={cx(btn, 'h-control-sm font-mono text-small')}
                  onClick={() => setSource(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 1 && addon ? (
          <>
            <div className="text-body">
              Found <b>{addon.name}</b>{' '}
              <span className="text-muted">— {addon.about || addon.source}</span>
            </div>
            <div className="flex flex-col rounded-card border border-line bg-card">
              {addon.parts.length === 0 ? (
                <div className="px-3 py-[10px] text-body text-muted">
                  Nothing ready to use yet — build it, or add a part below.
                </div>
              ) : null}
              {addon.parts.map((part, i) => (
                <PartEditor
                  key={part.id}
                  part={part}
                  onChange={(next) => setPart(i, next)}
                  onRemove={() =>
                    setAddon({...addon, parts: addon.parts.filter((_, j) => j !== i)})
                  }
                />
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
              <button type="button" className={btn} onClick={() => addPart('mcp')}>
                + MCP server
              </button>
              <button type="button" className={btn} onClick={() => addPart('rule')}>
                + Rule
              </button>
              <button type="button" className={btn} onClick={() => addPart('prompt')}>
                + Prompt
              </button>
            </div>
            {addon.python ? (
              <PythonEnv
                python={addon.python}
                onChange={(python) =>
                  // The build command follows the environment unless it was edited.
                  setAddon({
                    ...addon,
                    python,
                    buildCommand:
                      addon.buildCommand === suggestPythonBuild(addon.python!)
                        ? suggestPythonBuild(python)
                        : addon.buildCommand,
                  })
                }
              />
            ) : null}
            <div className="flex flex-col gap-2 rounded-card border border-line bg-card p-3">
              <Field
                label="Build command"
                hint={
                  addon.python && addon.python.env !== 'none'
                    ? 'Runs in its folder, inside the Python environment above.'
                    : 'Runs in its folder in your shell.'
                }
              >
                {(control) => (
                  <div className="flex gap-2">
                    <input
                      {...control}
                      value={addon.buildCommand ?? ''}
                      placeholder="npm install && npm run build"
                      onChange={(e) =>
                        setAddon({...addon, buildCommand: e.target.value || undefined})
                      }
                      className={cx(mono, 'flex-1')}
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
                )}
              </Field>
              {run ? (
                <Terminal runId={run.runId} onDone={(code) => setRun((r) => r && {...r, code})} />
              ) : null}
              <span
                role="status"
                className={cx('text-small', run?.code === 0 ? 'text-accent' : 'text-danger')}
              >
                {run && run.code !== undefined
                  ? run.code === 0
                    ? 'Built.'
                    : `Stopped with code ${run.code}.`
                  : ''}
              </span>
            </div>
          </>
        ) : null}

        {step === 2 && addon ? (
          <div className="flex flex-col gap-3">
            <div className="text-title font-bold">
              Allow <span className="text-accent">{addon.name}</span> to:
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {risks.map((r) => (
                <li
                  key={r.text}
                  className={cx(
                    'flex items-start gap-2 rounded-card border px-3 py-2 text-body',
                    r.high ? 'bg-danger/5 border-danger' : 'border-line bg-card'
                  )}
                >
                  <Icon
                    icon={r.high ? 'lucide:terminal-square' : 'lucide:shield-check'}
                    className={cx('mt-[2px] shrink-0', r.high ? 'text-danger' : 'text-muted')}
                  />
                  <span>
                    {r.text}
                    {r.high ? (
                      <span className="block text-small text-muted">
                        Runs with your user&apos;s access to this Mac.
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-small text-muted" title={addon.source}>
              From {sourceName}. It joins this window&apos;s stack, switched on; you can switch any
              part off later.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="m-0 text-body text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">
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
const Manager = ({state}: {state: AddonsState}) => {
  const [selected, setSelected] = useState<string | undefined>(state.addons[0]?.id);
  const [installing, setInstalling] = useState(state.addons.length === 0);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [stale, setStale] = useState<Addon[]>([]);
  const [confirm, setConfirm] = useState(false);
  const stack = state.stacks.find((s) => s.id === state.stackId);
  const addon = state.addons.find((a) => a.id === selected) ?? state.addons[0];
  const enabled = Boolean(addon && stack?.addons[addon.id]?.enabled);

  useEffect(() => {
    addonsRequest<AddonSizes>({operation: 'sizes'})
      .then((all) =>
        setSizes(Object.fromEntries(Object.entries(all).map(([id, s]) => [id, s.files + s.env])))
      )
      .catch(() => {});
    addonsRequest<Addon[]>({operation: 'stale'})
      .then(setStale)
      .catch(() => {});
  }, [state.addons.length]);
  useEffect(() => setConfirm(false), [addon?.id]);

  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  if (installing) return <Install onDone={() => setInstalling(false)} />;
  return (
    <>
      {stale.length > 0 ? (
        <div
          role="alert"
          className="bg-hover/40 flex flex-col gap-2 border-b border-line-soft px-4 py-3 text-body"
        >
          <span className="flex items-center gap-2 font-bold">
            <Icon icon="lucide:clock" className="text-muted" />
            Not used for six months — delete them and their data?
          </span>
          {stale.map((a) => (
            <div key={a.id} className="flex items-center gap-2">
              <span className="flex-1">
                {a.name}
                <span className="text-muted">
                  {' '}
                  · {sizes[a.id] ? formatSize(sizes[a.id]) : 'no files of its own'}
                </span>
              </span>
              <button
                type="button"
                className={cx(btn, 'h-control-sm')}
                onClick={() => addonsRequest({operation: 'keep', id: a.id}).catch(() => {})}
              >
                Keep
              </button>
              <button
                type="button"
                className={cx(danger, 'h-control-sm')}
                onClick={() => addonsRequest({operation: 'uninstall', id: a.id}).catch(() => {})}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[300px] shrink-0 flex-col gap-[2px] overflow-y-auto border-r border-line-soft p-2">
          {state.addons.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-current={a.id === addon?.id ? 'true' : undefined}
              onClick={() => setSelected(a.id)}
              className={cx(
                'flex w-full items-center gap-[10px] rounded-lg px-[10px] py-[9px] text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                a.id === addon?.id ? 'bg-active' : 'hover:bg-hover'
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'h-2 w-2 shrink-0 rounded-full',
                  stack?.addons[a.id]?.enabled ? 'bg-accent' : 'bg-control-off'
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-bold">{a.name}</span>
                <span className="text-fg/70 block truncate text-small">{a.source}</span>
              </span>
            </button>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            className={cx(primary, 'h-control-lg')}
            onClick={() => setInstalling(true)}
          >
            + Install add-on
          </button>
          <div className="px-1 pt-2 text-caption text-muted">
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
                <div className="text-heading font-bold">{addon.name}</div>
                <div className="mt-1 truncate font-mono text-small text-muted">{addon.source}</div>
                {addon.about ? (
                  <div className="mt-2 text-body text-muted">{addon.about}</div>
                ) : null}
              </div>
              <Toggle
                isOn={enabled}
                aria-label={`${addon.name} on in this stack`}
                onChange={() =>
                  addonsRequest({operation: 'set-enabled', addonId: addon.id, enabled: !enabled})
                }
              />
            </div>
            <div className="rounded-card border border-line bg-card">
              <SectionCaption className="px-3 pb-2 pt-[10px]">
                What it adds — switch each part
              </SectionCaption>
              {addon.parts.map((part) => {
                const on = partOn(stack, addon.id, part.id);
                return (
                  <div
                    key={part.id}
                    className="flex items-center gap-3 border-t border-line-soft px-3 py-3"
                  >
                    <span className={cx('min-w-0 flex-1', {'opacity-60': !enabled})}>
                      <span className="block text-body font-bold">{KIND[part.kind]}</span>
                      <span className="block truncate text-small text-muted">
                        {partDetail(part)}
                      </span>
                    </span>
                    <Toggle
                      isOn={on}
                      disabled={!enabled}
                      aria-label={`${KIND[part.kind]} on`}
                      onChange={() =>
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
              {!enabled ? (
                <div className="border-t border-line-soft px-3 py-2 text-small text-muted">
                  Turn the add-on on to change its parts.
                </div>
              ) : null}
            </div>
            <details className="rounded-card border border-line bg-card">
              <summary className="cursor-pointer px-3 py-[10px] text-small font-bold uppercase tracking-[0.08em] text-muted">
                Allowed when you installed it
              </summary>
              {addon.permissions.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-2 border-t border-line-soft px-3 py-2 text-body"
                >
                  <Icon icon="lucide:shield-check" className="text-muted" />
                  {p}
                </div>
              ))}
            </details>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-small text-muted">
                {sizes[addon.id] ? `${formatSize(sizes[addon.id])} · ` : ''}last used{' '}
                {new Date(addon.lastUsedAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                className={danger}
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
        ) : null}
      </div>
    </>
  );
};

/** Stack picker and "save as stack" in the dialog's title row. */
const StackActions = ({state}: {state: AddonsState}) => {
  const [naming, setNaming] = useState<string | null>(null);
  if (naming !== null)
    return (
      <>
        <input
          aria-label="New stack name"
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          placeholder="Web 3D dev"
          className={cx(inputClass, 'w-40')}
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
        <button type="button" className={btn} onClick={() => setNaming(null)}>
          Cancel
        </button>
      </>
    );
  return (
    <>
      <SectionCaption className="">Stack</SectionCaption>
      <select
        aria-label="Stack for this window"
        value={state.stackId}
        onChange={(e) => addonsRequest({operation: 'use-stack', stackId: e.target.value})}
        className={cx(inputClass, 'h-control font-bold')}
      >
        {state.stacks.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id === 'default' ? 'Default stack' : s.name}
          </option>
        ))}
      </select>
      <button type="button" className={btn} onClick={() => setNaming('')}>
        Save these switches as a stack…
      </button>
    </>
  );
};

/** Toolbar button: an icon with a count; the stack's name is in its tooltip. */
export const AddonsButton = () => {
  const {state} = useAddons();
  const [open, setOpen] = useState(false);
  const stack = state?.stacks.find((s) => s.id === state.stackId);
  const on = Object.values(stack?.addons ?? {}).filter((a) => a.enabled).length;
  const stackName = stack && stack.id !== 'default' ? stack.name : 'Default stack';
  return (
    <>
      <button
        type="button"
        title={`Add-ons — ${stackName}, ${on} on`}
        aria-label={`Add-ons, ${on} on`}
        data-testid="addons-button"
        onClick={() => setOpen(true)}
        className={cx(
          'w-control relative flex h-control items-center justify-center rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          on > 0 ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'
        )}
      >
        <span className="pointer-events-none contents">
          <Icon icon="lucide:puzzle" fontSize={16} />
          {on > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">
              {on}
            </span>
          ) : null}
        </span>
      </button>
      <DialogShell
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Add-ons"
        actions={state ? <StackActions state={state} /> : null}
      >
        {state ? <Manager state={state} /> : null}
      </DialogShell>
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
  const tabId = (key: string) => `addon-tab-${key.replace(/[^a-z0-9-]/gi, '-')}`;
  if (hidden)
    return (
      <button
        type="button"
        title="Show add-on panels"
        aria-label="Show add-on panels"
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
        <div role="tablist" aria-label="Add-on panels" className="flex flex-1 gap-1">
          {panels.map((p) => (
            <button
              key={p.key}
              id={tabId(p.key)}
              type="button"
              role="tab"
              aria-selected={p.key === active.key}
              aria-controls={`${tabId(p.key)}-panel`}
              tabIndex={p.key === active.key ? 0 : -1}
              onClick={() => setTab(p.key)}
              onKeyDown={(e) => {
                const i = panels.findIndex((x) => x.key === active.key);
                const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
                if (next !== null) setTab(panels[(next + panels.length) % panels.length].key);
              }}
              className={cx(
                'h-control rounded-control px-3 text-body focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                p.key === active.key ? 'bg-hover font-bold text-fg' : 'text-muted hover:text-fg'
              )}
            >
              {p.addon.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          title="Hide panels"
          aria-label="Hide panels"
          onClick={() => setHidden(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <Icon icon="lucide:panel-right-close" />
        </button>
      </div>
      {/* Every panel stays mounted (its app keeps state); only the active one shows. */}
      {panels.map((p) => (
        <div
          key={p.key}
          id={`${tabId(p.key)}-panel`}
          role="tabpanel"
          aria-labelledby={tabId(p.key)}
          className={cx('flex min-h-0 flex-1', {hidden: p.key !== active.key})}
        >
          <webview
            src={p.part.url}
            /* eslint-disable-next-line react/no-unknown-property */
            partition={`persist:addon-${p.addon.id}`}
            className="min-h-0 flex-1 bg-white"
          />
        </div>
      ))}
    </div>
  );
};
