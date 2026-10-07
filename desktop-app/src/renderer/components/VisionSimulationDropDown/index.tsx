import {Icon} from '@iconify/react';
import cx from 'classnames';
import {useState} from 'react';
import MenuRow from '../MenuRow';
import Popover from '../Popover';

export const SIMULATIONS = {
  DEUTERANOPIA: 'deuteranopia',
  DEUTERANOMALY: 'deuteranomaly',
  PROTANOPIA: 'protanopia',
  PROTANOMALY: 'protanomaly',
  TRITANOPIA: 'tritanopia',
  TRITANOMALY: 'tritanomaly',
  ACHROMATOMALY: 'achromatomaly',
  ACHROMATOPSIA: 'achromatopsia',
  CATARACT: 'cataract',
  FAR: 'farsightedness',
  GLAUCOME: 'glaucoma',
  SOLARIZE: 'solarize',
  COLOR_CONTRAST_LOSS: 'color-contrast-loss',
};

export const RED_GREEN = [
  SIMULATIONS.DEUTERANOPIA,
  SIMULATIONS.DEUTERANOMALY,
  SIMULATIONS.PROTANOPIA,
  SIMULATIONS.PROTANOMALY,
];
export const BLUE_YELLOW = [SIMULATIONS.TRITANOPIA, SIMULATIONS.TRITANOMALY];
export const FULL = [SIMULATIONS.ACHROMATOMALY, SIMULATIONS.ACHROMATOPSIA];
export const VISUAL_IMPAIRMENTS = [
  SIMULATIONS.CATARACT,
  SIMULATIONS.FAR,
  SIMULATIONS.GLAUCOME,
  SIMULATIONS.COLOR_CONTRAST_LOSS,
];
export const SUNLIGHT = [SIMULATIONS.SOLARIZE];

// The approved Simulate design: three kinds, one open at a time, so the list
// never runs off the window.
const KINDS: Array<{
  id: string;
  name: string;
  sub: string;
  options: Array<{value: string; name: string; desc: string}>;
}> = [
  {
    id: 'cvd',
    name: 'Colour blindness',
    sub: 'Some colours look the same',
    options: [
      {
        value: SIMULATIONS.DEUTERANOMALY,
        name: 'Deuteranomaly',
        desc: 'Weak green — the most common',
      },
      {
        value: SIMULATIONS.DEUTERANOPIA,
        name: 'Deuteranopia',
        desc: 'No green — red and green look alike',
      },
      {value: SIMULATIONS.PROTANOMALY, name: 'Protanomaly', desc: 'Weak red'},
      {value: SIMULATIONS.PROTANOPIA, name: 'Protanopia', desc: 'No red — reds look dark'},
      {value: SIMULATIONS.TRITANOMALY, name: 'Tritanomaly', desc: 'Weak blue'},
      {
        value: SIMULATIONS.TRITANOPIA,
        name: 'Tritanopia',
        desc: 'No blue — blue and yellow look alike',
      },
      {value: SIMULATIONS.ACHROMATOMALY, name: 'Achromatomaly', desc: 'Very faint colour'},
      {value: SIMULATIONS.ACHROMATOPSIA, name: 'Achromatopsia', desc: 'No colour, only greys'},
    ],
  },
  {
    id: 'eye',
    name: 'Eye conditions',
    sub: 'Blur, tunnel vision, low contrast',
    options: [
      {value: SIMULATIONS.CATARACT, name: 'Cataract', desc: 'Blurry and yellowed'},
      {value: SIMULATIONS.FAR, name: 'Farsightedness', desc: 'Blurry up close'},
      {value: SIMULATIONS.GLAUCOME, name: 'Glaucoma', desc: 'Tunnel vision — dark edges'},
      {
        value: SIMULATIONS.COLOR_CONTRAST_LOSS,
        name: 'Contrast loss',
        desc: 'Everything washed out',
      },
    ],
  },
  {
    id: 'sit',
    name: 'Situations',
    sub: 'Hard viewing conditions',
    options: [{value: SIMULATIONS.SOLARIZE, name: 'Bright sunlight', desc: 'Glare on the screen'}],
  },
];

const Check = ({on}: {on: boolean}) => (
  <Icon
    icon="ic:round-check"
    fontSize={14}
    className={cx('shrink-0 text-accent', {'opacity-0': !on})}
  />
);

const SimulationMenu = ({
  simulationName,
  pick,
  isToolbar,
}: {
  simulationName: string | undefined;
  pick: (name: string | undefined) => void;
  isToolbar: boolean;
}) => {
  const [open, setOpen] = useState<string | null>(
    KINDS.find((k) => k.options.some((o) => o.value === simulationName))?.id ?? 'cvd'
  );
  return (
    <>
      <div className="px-[10px] pb-[6px] pt-2">
        <div className="text-[13.5px] font-bold">Simulate vision</div>
        <div className="mt-[2px] text-[11.5px] text-muted">
          {isToolbar ? 'Applies to every device in this window' : 'Applies to this device only'}
        </div>
      </div>
      <MenuRow
        aria-pressed={simulationName === undefined}
        onClick={() => pick(undefined)}
        leading={<Check on={simulationName === undefined} />}
        label="Off — normal vision"
      />
      <div className="mx-1 my-[6px] border-t border-line-soft" />
      {KINDS.map((kind) => {
        const isOpen = open === kind.id;
        return (
          <div key={kind.id}>
            <MenuRow
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : kind.id)}
              leading={
                <Icon
                  icon="lucide:chevron-right"
                  fontSize={14}
                  className={cx('shrink-0 text-muted transition-transform', {'rotate-90': isOpen})}
                />
              }
              label={kind.name}
              bold
              sub={kind.sub}
              trailing={
                <>
                  {kind.options.some((o) => o.value === simulationName) ? (
                    <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-accent" />
                  ) : null}
                  <span className="text-caption text-muted">{kind.options.length}</span>
                </>
              }
            />
            {isOpen ? (
              <div className="pb-1 pl-[14px]">
                {kind.options.map((option) => (
                  <MenuRow
                    key={option.value}
                    aria-pressed={simulationName === option.value}
                    onClick={() => pick(option.value)}
                    className="py-[5px]"
                    leading={<Check on={simulationName === option.value} />}
                    label={option.name}
                    sub={option.desc}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {isToolbar ? (
        <>
          <div className="mx-1 my-[6px] border-t border-line-soft" />
          <div className="px-[10px] pb-2 pt-[6px] text-[11.5px] leading-normal text-muted">
            Just one device? Use the eye button in that device&apos;s header.
          </div>
        </>
      ) : null}
    </>
  );
};

interface Props {
  simulationName: string | undefined;
  onChange: (name: string | undefined) => void;
  /**
   * `toolbar` shows the labelled action, `icon` the toolbar's icon + chevron;
   * `compact` is icon-only (per device).
   */
  variant?: 'toolbar' | 'icon' | 'compact';
}

export const VisionSimulationDropDown = ({
  simulationName,
  onChange,
  variant = 'compact',
}: Props) => {
  const isSimulating = simulationName != null;
  const isToolbar = variant !== 'compact';
  const isLabelled = variant === 'toolbar';

  return (
    <Popover
      triggerTitle="Simulate vision"
      anchor={isToolbar ? 'bottom end' : 'bottom start'}
      className="max-h-[min(620px,calc(100vh-120px))] w-[320px] overflow-y-auto p-[6px]"
      triggerClassName={cx(
        'flex items-center transition-colors',
        isLabelled && 'h-[30px] gap-[7px] rounded-[7px] px-[11px] text-[12.5px]',
        variant === 'icon' && 'h-[30px] gap-[2px] rounded-lg px-[7px]',
        variant === 'compact' && 'h-7 w-7 justify-center rounded-md text-[18px]',
        isSimulating && 'bg-accent-soft text-accent',
        !isSimulating &&
          (variant === 'icon'
            ? 'text-muted hover:bg-hover hover:text-fg'
            : 'text-fg hover:bg-hover')
      )}
      trigger={
        <span className="pointer-events-none contents">
          <Icon icon="bx:low-vision" fontSize={isToolbar ? 16 : 18} />
          {isLabelled ? 'Simulate' : null}
          {isToolbar ? (
            <Icon icon="mdi:chevron-down" fontSize={isLabelled ? 13 : 11} className="text-muted" />
          ) : null}
        </span>
      }
    >
      {({close}) => (
        <SimulationMenu
          simulationName={simulationName}
          isToolbar={isToolbar}
          pick={(name) => {
            onChange(name);
            close();
          }}
        />
      )}
    </Popover>
  );
};
