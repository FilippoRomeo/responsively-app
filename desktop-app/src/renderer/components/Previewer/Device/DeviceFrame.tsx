import {Icon} from '@iconify/react';
import cx from 'classnames';
import {Device as IDevice} from 'common/deviceList';
import {ReactNode} from 'react';
import Spinner from 'renderer/components/Spinner';
import {
  overlayModeOf,
  type DesignOverlayState,
  type ViewResolution,
} from '../../../store/features/design-overlay';
import {Coordinates} from '../../../store/features/ruler';
import GuideGrid, {DefaultGuide} from '../Guides';
import ScaledFrame from '../ScaledFrame';
import DesignOverlay from './DesignOverlay';
import type {NavigationState} from './navigationMachine';

const RULER_GUTTER = 30;

/** Hardware bezel geometry per form factor (Hybrid Studio canvas design). */
const BEZELS: Record<string, {pad: string; radius: string; screenRadius: number}> = {
  phone: {pad: '16px 7px', radius: '30px', screenRadius: 12},
  tablet: {pad: '16px 12px', radius: '20px', screenRadius: 6},
  notebook: {pad: '10px 10px 14px', radius: '14px 14px 3px 3px', screenRadius: 3},
};
const BUTTON = 'absolute bg-[#3a3d45]';

interface Props {
  device: IDevice;
  width: number;
  height: number;
  zoomfactor: number;
  rulerActive: boolean;
  navigation: NavigationState;
  screenshotInProgress: boolean;
  coordinates: Coordinates;
  darkMode: boolean;
  defaultGuides: DefaultGuide[];
  designOverlay: DesignOverlayState | undefined;
  resolution: ViewResolution;
  isRestrictedMinimumDeviceSize: boolean;
  /** Canvas view options: hardware bezel + label visibility. */
  showBezel: boolean;
  showName: boolean;
  showDims: boolean;
  isRotated: boolean;
  /** Active vision simulation, shown as a badge next to the label. */
  simulationName: string | undefined;
  /** Brief capture feedback overlay. */
  flashing: boolean;
  initialSrc: string;
  /** A browser's chrome above the page (laptops): outside the viewport, so it takes no pixels. */
  browserBar?: (width: number, radius: number) => ReactNode;
  /** Callback ref — never a ref object (see Device for why). */
  webviewRef: (element: Electron.WebviewTag | null) => void;
  toolbar: ReactNode;
  /** Header badge naming a non-Chromium browser (Safari · iOS 26.1). */
  browserBadge?: ReactNode;
  /** The test conditions on this preview, with a way to clear them. */
  conditionsBadge?: ReactNode;
  /** Takes the device out of the suite (absent: it is the last one). */
  onRemove?: () => void;
  /** Replaces the preview with another browser's screen (real iOS Safari). */
  screenOverride?: ReactNode;
}

/**
 * Presentational shell of one preview: header, toolbar, the scaled webview
 * frame with guides, and the loading/error/screenshot overlays. All behavior
 * lives in the Device orchestrator and its hooks.
 */
const DeviceFrame = ({
  device,
  width,
  height,
  zoomfactor,
  rulerActive,
  navigation,
  screenshotInProgress,
  coordinates,
  darkMode,
  defaultGuides,
  designOverlay,
  resolution,
  isRestrictedMinimumDeviceSize,
  showBezel,
  showName,
  showDims,
  isRotated,
  simulationName,
  flashing,
  initialSrc,
  webviewRef,
  toolbar,
  browserBadge,
  conditionsBadge,
  onRemove,
  browserBar,
  screenOverride,
}: Props) => {
  const scaledHeight = height * zoomfactor;
  const scaledWidth = width * zoomfactor;
  const rulerOffset = rulerActive ? RULER_GUTTER : 0;
  const bezel = showBezel ? (BEZELS[device.type] ?? BEZELS.notebook) : null;
  const isLaptop = device.type === 'notebook';

  return (
    <div
      // A frame around a narrow phone needs more than the 208px a bare one gets.
      className={cx('group relative h-fit', {
        'w-52': isRestrictedMinimumDeviceSize && bezel === null,
        'min-w-52': isRestrictedMinimumDeviceSize && bezel !== null,
      })}
    >
      {/* The label row is also the canvas drag handle, so it stays in the
          tree even when name and dims are toggled off. */}
      <div
        className="flex min-h-[20px] items-baseline gap-2 pb-[2px]"
        data-device-label={device.name}
      >
        {showName ? <span className="text-[13px] font-bold">{device.name}</span> : null}
        {showDims ? (
          <span className="font-mono text-[11px] text-muted">
            {width} × {height}
          </span>
        ) : null}
        {simulationName !== undefined ? (
          <span
            data-testid="sim-badge"
            className="rounded-full bg-accent-soft px-2 py-[2px] text-[10.5px] capitalize text-accent"
          >
            {simulationName}
          </span>
        ) : null}
        {browserBadge}
        {conditionsBadge}
        <span className="flex-1" />
        {navigation.loading && !screenOverride ? <Spinner spinnerHeight={20} /> : null}
        {onRemove ? (
          <button
            type="button"
            title={`Remove ${device.name}`}
            aria-label={`Remove ${device.name}`}
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center self-center rounded-md text-[13px] text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <span className="pointer-events-none contents">
              <Icon icon="lucide:x" />
            </span>
          </button>
        ) : null}
      </div>
      {toolbar}
      <div className="flex gap-4">
        <div
          data-bezel={bezel !== null || undefined}
          className="relative"
          style={
            bezel !== null
              ? {
                  padding: bezel.pad,
                  borderRadius: bezel.radius,
                  background: 'linear-gradient(145deg,#3a3d45,#1b1d22)',
                  boxShadow: '0 10px 30px rgba(0,0,0,.35)',
                  width: 'fit-content',
                }
              : undefined
          }
        >
          {bezel !== null && device.type === 'phone' && !isRotated ? (
            <>
              <i className={cx(BUTTON, '-left-[3px] top-[78px] h-[22px] w-[3px] rounded-l-sm')} />
              <i className={cx(BUTTON, '-left-[3px] top-[116px] h-10 w-[3px] rounded-l-sm')} />
              <i className={cx(BUTTON, '-left-[3px] top-[166px] h-10 w-[3px] rounded-l-sm')} />
              <i className={cx(BUTTON, '-right-[3px] top-[130px] h-16 w-[3px] rounded-r-sm')} />
              <div
                data-testid="frame-notch"
                className="absolute left-1/2 top-[16px] z-[3] h-3 -translate-x-1/2 rounded-b-[14px] bg-[#0a0a0c]"
                style={{width: Math.max(40, Math.round(scaledWidth * 0.33))}}
              />
            </>
          ) : null}
          {bezel !== null && device.type === 'tablet' && !isRotated ? (
            <>
              <div className="absolute left-1/2 top-[6px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-[#1d1f24]" />
              <i className={cx(BUTTON, '-top-[3px] right-[42px] h-[3px] w-[34px] rounded-t-sm')} />
            </>
          ) : null}
          {bezel !== null && isLaptop ? (
            <>
              <div
                data-testid="frame-camera"
                className="absolute left-1/2 top-0 z-[3] h-[10px] w-14 -translate-x-1/2 rounded-b-[7px] bg-[#0a0a0c]"
              />
              <div
                data-testid="frame-base"
                className="absolute -bottom-[12px] left-1/2 h-3 -translate-x-1/2 rounded-b-[14px] rounded-t-[2px] shadow-[0_10px_18px_rgba(0,0,0,.35)]"
                style={{
                  width: scaledWidth + 20 + 60,
                  background: 'linear-gradient(180deg,#5a5d66,#2a2c32)',
                }}
              >
                <div className="absolute left-1/2 top-0 h-1 w-[72px] -translate-x-1/2 rounded-b-md bg-[#1c1d21]" />
              </div>
            </>
          ) : null}
          {browserBar ? browserBar(scaledWidth + rulerOffset, bezel?.screenRadius ?? 0) : null}
          <ScaledFrame
            width={width}
            height={height}
            scale={zoomfactor}
            offset={rulerOffset}
            className="bg-white"
            style={
              bezel !== null
                ? {
                    borderRadius: browserBar
                      ? `0 0 ${bezel.screenRadius}px ${bezel.screenRadius}px`
                      : bezel.screenRadius,
                  }
                : undefined
            }
          >
            {bezel !== null && device.type === 'phone' && !isRotated ? (
              <>
                <div
                  data-testid="frame-status"
                  className="pointer-events-none absolute inset-x-0 top-0 z-[3] flex h-4 items-center justify-between px-[14px] text-[8px] font-bold text-black mix-blend-difference"
                >
                  <span className="text-white">9:41</span>
                  <span className="text-white">5G ▮▮▮</span>
                </div>
                <div
                  className="pointer-events-none absolute bottom-[5px] left-1/2 z-[3] h-[3px] -translate-x-1/2 rounded-full bg-white mix-blend-difference"
                  style={{width: Math.max(40, Math.round(scaledWidth * 0.27))}}
                />
              </>
            ) : null}
            <GuideGrid
              scaledHeight={scaledHeight}
              scaledWidth={scaledWidth}
              height={height}
              width={width}
              coordinates={coordinates}
              zoomFactor={zoomfactor}
              night={darkMode}
              enabled={rulerActive}
              defaultGuides={defaultGuides}
            />
            <div className="bg-white">
              <webview
                id={device.name}
                src={initialSrc}
                style={{
                  height,
                  width,
                  display: 'inline-flex',
                  transform: `scale(${zoomfactor})`,
                  marginLeft: rulerActive ? `${RULER_GUTTER}px` : 0,
                  marginTop: rulerActive ? `${RULER_GUTTER}px` : 0,
                }}
                ref={webviewRef}
                className="origin-top-left"
                /* eslint-disable-next-line react/no-unknown-property */
                preload={`file://${window.responsively.webviewPreloadPath}`}
                data-scale-factor={zoomfactor}
                /* React drops boolean-valued unknown attributes entirely, so this
                 must be a string for the attribute to reach the DOM at all.
                 (@types/react declares it boolean, which react-dom never renders.) */
                /* eslint-disable-next-line react/no-unknown-property */
                allowpopups={'true' as unknown as boolean}
                /* eslint-disable-next-line react/no-unknown-property */
                useragent={device.userAgent}
              />
            </div>

            {designOverlay?.enabled && overlayModeOf(designOverlay) === 'grid' ? (
              <div
                data-testid="grid-overlay"
                className="pointer-events-none absolute z-[2]"
                style={{
                  left: rulerOffset,
                  top: rulerOffset,
                  width: scaledWidth,
                  height: scaledHeight,
                  opacity: designOverlay.opacity / 100,
                  backgroundImage:
                    'repeating-linear-gradient(90deg, rgba(236,72,153,.45) 0 56px, transparent 56px 84px)',
                  boxShadow: 'inset 0 0 0 1px rgba(236,72,153,.35)',
                }}
              />
            ) : null}
            {designOverlay?.enabled &&
              overlayModeOf(designOverlay) === 'image' &&
              designOverlay.image &&
              designOverlay.position === 'overlay' && (
                <DesignOverlay
                  resolution={resolution}
                  scaledWidth={scaledWidth}
                  scaledHeight={scaledHeight}
                  zoomFactor={zoomfactor}
                  coordinates={coordinates}
                  position={designOverlay.position}
                  rulerMargin={rulerOffset}
                  width={width}
                  height={height}
                />
              )}

            {screenshotInProgress ? (
              <div
                className="absolute left-0 top-0 flex h-full w-full items-center justify-center bg-slate-600 bg-opacity-95"
                style={{height: scaledHeight, width: scaledWidth}}
              >
                <Spinner spinnerHeight={30} />
              </div>
            ) : null}
            {flashing ? (
              <div
                data-testid="capture-flash"
                className="absolute left-0 top-0 z-10 flex items-center justify-center bg-[var(--flash)]"
                style={{height: scaledHeight, width: scaledWidth}}
              >
                <Icon icon="lucide:camera" fontSize={26} className="text-[#333]" />
              </div>
            ) : null}
            {navigation.error != null ? (
              <div
                className="absolute left-0 top-0 flex h-full w-full items-center justify-center bg-slate-600 bg-opacity-95"
                style={{height: scaledHeight, width: scaledWidth}}
              >
                <div className="text-center text-sm text-white">
                  <div className="text-base font-bold">ERROR: {navigation.error.code}</div>
                  <div className="text-sm">{navigation.error.description}</div>
                </div>
              </div>
            ) : null}
            {screenOverride ? (
              <div className="absolute z-[5]" style={{left: rulerOffset, top: rulerOffset}}>
                {screenOverride}
              </div>
            ) : null}
          </ScaledFrame>
        </div>

        {designOverlay?.enabled &&
          overlayModeOf(designOverlay) === 'image' &&
          designOverlay.image &&
          designOverlay.position === 'side' && (
            <DesignOverlay
              resolution={resolution}
              scaledWidth={scaledWidth}
              scaledHeight={scaledHeight}
              zoomFactor={zoomfactor}
              coordinates={coordinates}
              position={designOverlay.position}
              rulerMargin={rulerOffset}
              width={width}
              height={height}
            />
          )}
      </div>
    </div>
  );
};

export default DeviceFrame;
