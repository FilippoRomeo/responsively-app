import {Icon} from '@iconify/react';
import cx from 'classnames';
import {useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import Popover from 'renderer/components/Popover';
import {
  previewsScheme,
  setPreviewsScheme,
  type Scheme,
} from 'renderer/components/Previewer/Device/scheme';
import {
  Palette,
  selectDarkMode,
  selectPalette,
  setDarkMode,
  setPalette,
} from 'renderer/store/features/ui';

// Swatches mirror the palettes in App.css: titlebar, background, line.
const PALETTE_INFO: Record<Palette, {name: string; note: string; swatch: string[]}> = {
  graphite: {name: 'Graphite', note: 'Neutral grey', swatch: ['#0e0e10', '#18181b', '#303036']},
  stone: {name: 'Stone', note: 'Warm charcoal', swatch: ['#110f0d', '#1c1917', '#3a342f']},
  black: {name: 'Black', note: 'Highest contrast', swatch: ['#000000', '#0a0a0a', '#262626']},
  midnight: {
    name: 'Midnight',
    note: 'The original blue',
    swatch: ['#10161f', '#151d29', '#273246'],
  },
};

type PreviewScheme = Scheme | 'site';

const Segment = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    className="mx-[10px] flex gap-[2px] rounded-lg border border-line p-[2px]"
  >
    {options.map(([id, text]) => (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={value === id}
        onClick={() => onChange(id)}
        className={cx(
          'h-[26px] flex-1 rounded-md text-[12px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          value === id ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
        )}
      >
        {text}
      </button>
    ))}
  </div>
);

const Caption = ({children}: {children: string}) => (
  <div className="px-[10px] pb-[6px] pt-[12px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
    {children}
  </div>
);

/** Responsively's own look (light/dark, colours) and the previews' colour scheme. */
const AppearanceMenu = () => {
  const dispatch = useDispatch();
  const darkMode = useSelector(selectDarkMode);
  const palette = useSelector(selectPalette);
  const [previews, setPreviews] = useState<PreviewScheme>(previewsScheme() ?? 'site');
  const setPreviewScheme = (value: PreviewScheme) => {
    setPreviews(value);
    setPreviewsScheme(value === 'site' ? null : value);
  };
  return (
    <Popover
      triggerTitle="Appearance"
      triggerClassName="flex h-[30px] items-center gap-[2px] rounded-lg px-1 text-[15px] text-muted hover:bg-hover hover:text-fg data-[open]:bg-accent-soft data-[open]:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      trigger={
        <span
          className="pointer-events-none flex items-center gap-[2px]"
          data-testid="appearance-button"
        >
          <Icon icon="lucide:contrast" />
          <Icon icon="lucide:chevron-down" fontSize={11} />
        </span>
      }
      className="w-[320px] pb-[10px] pt-[2px]"
    >
      <div data-testid="appearance-menu">
        <Caption>Responsively window</Caption>
        <Segment
          label="Responsively window"
          value={darkMode ? 'dark' : 'light'}
          options={[
            ['dark', 'Dark'],
            ['light', 'Light'],
          ]}
          onChange={(v) => dispatch(setDarkMode(v === 'dark'))}
        />
        <Caption>Colour</Caption>
        <div role="radiogroup" aria-label="Colour" className="grid grid-cols-2 gap-2 px-[10px]">
          {(Object.keys(PALETTE_INFO) as Palette[]).map((id) => {
            const info = PALETTE_INFO[id];
            const checked = darkMode && palette === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                title={darkMode ? info.name : `${info.name} (switches to dark)`}
                onClick={() => {
                  dispatch(setPalette(id));
                  if (!darkMode) dispatch(setDarkMode(true));
                }}
                style={{background: info.swatch[1], color: '#e4e4e7'}}
                className={cx(
                  'flex flex-col gap-[6px] rounded-lg p-2 text-left text-[12px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                  checked ? 'ring-2 ring-accent' : 'ring-1 ring-white/10'
                )}
              >
                <span className="pointer-events-none flex gap-1">
                  {info.swatch.map((c) => (
                    <span key={c} className="h-[18px] w-[18px] rounded" style={{background: c}} />
                  ))}
                  <span className="h-[18px] w-[18px] rounded bg-[#2fd9a2]" />
                </span>
                <span className="pointer-events-none font-bold">{info.name}</span>
                <span className="pointer-events-none text-[11px] opacity-70">{info.note}</span>
              </button>
            );
          })}
        </div>
        <Caption>Previews · all devices</Caption>
        <Segment
          label="Previews colour scheme"
          value={previews}
          options={[
            ['site', 'Site default'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ]}
          onChange={setPreviewScheme}
        />
      </div>
    </Popover>
  );
};

export default AppearanceMenu;
