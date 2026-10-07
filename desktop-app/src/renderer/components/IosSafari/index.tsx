import {Icon} from '@iconify/react';
import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {
  runtimeLabel,
  type IosSimRequest,
  type IosSimState,
  type IosSimStream,
} from 'common/ios-simulator';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import MenuRow from 'renderer/components/MenuRow';
import Popover from 'renderer/components/Popover';
import SectionCaption from 'renderer/components/SectionCaption';
import {selectDeviceBrowser, setDeviceBrowser} from 'renderer/store/features/device-manager';
import {selectAddress} from 'renderer/store/features/renderer';

export const iosSim = <T,>(req: IosSimRequest) =>
  window.electron.ipcRenderer.invoke<IosSimRequest, T>(IPC_MAIN_CHANNELS.IOS_SIMULATOR, req);

export const formatGB = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

export {runtimeLabel};

const Check = ({on}: {on: boolean}) => (
  <Icon
    icon="ic:round-check"
    fontSize={14}
    className={cx('shrink-0 text-accent', {'opacity-0': !on})}
  />
);

/** The header chip that picks Chromium or real iOS Safari for one device. */
export const BrowserPicker = ({deviceId, deviceName}: {deviceId: string; deviceName: string}) => {
  const dispatch = useDispatch();
  const runtime = useSelector(selectDeviceBrowser(deviceId));
  const [state, setState] = useState<IosSimState | null>(null);
  const runtimes = state?.runtimes.filter((r) => r.deviceNames.includes(deviceName)) ?? [];
  const pick = (next?: string) => dispatch(setDeviceBrowser({id: deviceId, runtime: next}));
  return (
    <Popover
      triggerTitle="Browser for this device"
      anchor="bottom start"
      className="w-[330px] p-[6px]"
      onOpenChange={(open) => {
        if (open)
          Promise.resolve(iosSim<IosSimState>({operation: 'list'}))
            .then((value) => value && setState(value))
            .catch(() => {});
      }}
      triggerClassName={cx(
        'flex h-7 items-center gap-[2px] rounded-md px-[5px] text-[16px] transition-colors',
        runtime ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
      )}
      trigger={
        <span className="pointer-events-none contents" data-testid="browser-chip">
          <Icon icon={runtime ? 'lucide:compass' : 'lucide:globe'} />
          <Icon icon="mdi:chevron-down" fontSize={11} className="text-muted" />
        </span>
      }
    >
      {({close}) => (
        <>
          <div className="px-[10px] pb-[6px] pt-2">
            <div className="text-[13.5px] font-bold">Browser for this device</div>
            <div className="mt-[2px] text-[11.5px] text-muted">Other devices keep their own</div>
          </div>
          <MenuRow
            onClick={() => {
              pick(undefined);
              close();
            }}
            leading={<Check on={!runtime} />}
            label="Chromium"
            bold
            sub="Built in · instant · mirrors clicks across devices"
          />
          <div className="mx-1 my-[6px] border-t border-line-soft" />
          <SectionCaption>iOS Safari — real Safari in the iOS Simulator</SectionCaption>
          {state === null ? (
            <div className="px-[10px] py-[7px] text-[12px] text-muted">
              Looking for iOS versions…
            </div>
          ) : null}
          {state && !state.available ? (
            <div className="px-[10px] py-[7px] text-[12px] text-muted">{state.reason}</div>
          ) : null}
          {state?.available && runtimes.length === 0 ? (
            <div className="px-[10px] py-[7px] text-[12px] text-muted">
              No installed iOS version has a Simulator called “{deviceName}”
            </div>
          ) : null}
          {runtimes.map((r) => (
            <MenuRow
              key={r.id}
              onClick={() => {
                pick(r.id);
                close();
              }}
              leading={<Check on={runtime === r.id} />}
              label={r.name}
              sub={`Installed · ${formatGB(r.sizeBytes)}`}
            />
          ))}
          <MenuRow
            disabled
            leading={<Check on={false} />}
            label="Other iOS versions…"
            sub="Downloads come in the next step"
          />
          <div className="mx-1 my-[6px] border-t border-line-soft" />
          {['Desktop Safari', 'Firefox'].map((name) => (
            <MenuRow
              key={name}
              disabled
              leading={<Check on={false} />}
              label={name}
              trailing={<span className="text-caption text-muted">Later</span>}
            />
          ))}
          <div className="mx-1 my-[6px] border-t border-line-soft" />
          <div className="px-[10px] pb-2 pt-[6px] text-[11.5px] leading-normal text-muted">
            AI agents can choose this too. Manage downloads in Settings › Browsers.
          </div>
        </>
      )}
    </Popover>
  );
};

// USB HID keyboard usages (serve-sim's key messages), keyed by KeyboardEvent.code.
const HID: Record<string, number> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  ShiftLeft: 225,
  ShiftRight: 229,
  ControlLeft: 224,
  AltLeft: 226,
  MetaLeft: 227,
};
for (let i = 0; i < 26; i += 1) HID[`Key${String.fromCharCode(65 + i)}`] = 4 + i;
for (let i = 1; i <= 9; i += 1) HID[`Digit${i}`] = 29 + i;
HID.Digit0 = 39;

// serve-sim's control socket: one type byte, then JSON.
const MSG = {touch: 3, key: 6, rotate: 7};
const encode = (type: number, payload: unknown) => {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const bytes = new Uint8Array(1 + json.length);
  bytes[0] = type;
  bytes.set(json, 1);
  return bytes;
};

type Phase = 'booting' | 'live' | 'stopped' | 'error';

/**
 * Real Safari for one device: boots (or reuses) its iOS Simulator, shows the
 * serve-sim stream in place of the Chromium preview and sends the pointer and
 * keyboard back as touches and key presses. The address bar opens pages in it.
 */
export const SimulatorScreen = ({
  deviceName,
  runtime,
  width,
  height,
  rotated,
}: {
  deviceName: string;
  runtime: string;
  /** Scaled on-screen size of the frame. */
  width: number;
  height: number;
  rotated: boolean;
}) => {
  const address = useSelector(selectAddress);
  const [phase, setPhase] = useState<Phase>('booting');
  const [error, setError] = useState('');
  const [stream, setStream] = useState<IosSimStream | null>(null);
  const [attempt, setAttempt] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const down = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPhase('booting');
    (async () => {
      try {
        const value = await iosSim<IosSimStream>({operation: 'start', deviceName, runtime});
        if (cancelled || !value) return;
        setStream(value);
        setPhase('live');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceName, runtime, attempt]);

  // Leaving Safari (back to Chromium, device removed) stops its Simulator.
  const udid = stream?.udid;
  useEffect(
    () => () => {
      if (udid) iosSim({operation: 'stop', udid}).catch(() => {});
    },
    [udid]
  );

  useEffect(() => {
    if (phase !== 'live' || !stream) return undefined;
    const ws = new WebSocket(stream.wsUrl);
    ws.binaryType = 'arraybuffer';
    socket.current = ws;
    return () => {
      ws.close();
      socket.current = null;
    };
  }, [phase, stream]);

  useEffect(() => {
    if (phase === 'live' && stream && /^https?:\/\//i.test(address))
      iosSim({operation: 'open-url', udid: stream.udid, url: address}).catch(() => {});
  }, [phase, stream, address]);

  useEffect(() => {
    const ws = socket.current;
    if (phase !== 'live' || !ws) return;
    const send = () =>
      ws.send(encode(MSG.rotate, {orientation: rotated ? 'landscape_left' : 'portrait'}));
    if (ws.readyState === WebSocket.OPEN) send();
    else ws.addEventListener('open', send, {once: true});
  }, [phase, rotated]);

  const send = useCallback((type: number, payload: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(encode(type, payload));
  }, []);

  const touch = (type: 'begin' | 'move' | 'end', e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    send(MSG.touch, {type, x, y});
  };

  // A trackpad or wheel scroll becomes a short swipe at the pointer.
  const wheel = (e: React.WheelEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const dy = Math.max(-0.3, Math.min(0.3, -e.deltaY / rect.height));
    send(MSG.touch, {type: 'begin', x, y});
    send(MSG.touch, {type: 'move', x, y: Math.min(1, Math.max(0, y + dy / 2))});
    send(MSG.touch, {type: 'end', x, y: Math.min(1, Math.max(0, y + dy))});
  };

  const key = (type: 'down' | 'up', e: React.KeyboardEvent) => {
    const usage = HID[e.code];
    if (usage === undefined) return;
    e.preventDefault();
    send(MSG.key, {type, usage});
  };

  return (
    <div
      data-testid="ios-safari-screen"
      className="absolute left-0 top-0 z-[5] flex items-center justify-center bg-[#0a1019] text-center"
      style={{width, height}}
    >
      {phase === 'booting' ? (
        <div className="flex flex-col items-center gap-2 px-4">
          <Icon icon="line-md:loading-twotone-loop" fontSize={22} className="text-accent" />
          <span className="text-[12.5px] font-bold text-fg">Starting {deviceName}</span>
          <span className="text-[11px] leading-normal text-muted">
            Real Safari in the iOS Simulator
            <br />
            about 25 s the first time
          </span>
        </div>
      ) : null}
      {phase === 'error' ? (
        <div className="flex flex-col items-center gap-2 px-4">
          <span className="text-[12.5px] font-bold text-fg">Safari couldn’t start</span>
          <span className="text-[11px] leading-normal text-muted">{error}</span>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="h-7 rounded-[7px] bg-accent px-3 text-[12px] font-bold text-on-accent"
          >
            Try again
          </button>
        </div>
      ) : null}
      {phase === 'stopped' ? (
        <div className="flex flex-col items-center gap-2 px-4">
          <span className="text-[12.5px] font-bold text-fg">Simulator stopped</span>
          <span className="text-[11px] text-muted">Frees about 1.6 GB of memory</span>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="h-7 rounded-[7px] bg-accent px-3 text-[12px] font-bold text-on-accent"
          >
            Start again
          </button>
        </div>
      ) : null}
      {phase === 'live' && stream ? (
        <>
          <button
            type="button"
            aria-label={`Safari on ${deviceName}: tap, scroll and type here`}
            className="block h-full w-full cursor-default select-none p-0 outline-none"
            onPointerDown={(e) => {
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              down.current = true;
              touch('begin', e);
            }}
            onPointerMove={(e) => down.current && touch('move', e)}
            onPointerUp={(e) => {
              down.current = false;
              touch('end', e);
            }}
            onWheel={wheel}
            onKeyDown={(e) => key('down', e)}
            onKeyUp={(e) => key('up', e)}
          >
            <img
              src={stream.streamUrl}
              alt=""
              draggable={false}
              className="pointer-events-none h-full w-full object-fill"
            />
          </button>
          <button
            type="button"
            title="Stop the Simulator"
            onClick={() => {
              iosSim({operation: 'stop', udid: stream.udid}).catch(() => {});
              setStream(null);
              setPhase('stopped');
            }}
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70"
          >
            <Icon icon="lucide:power" fontSize={13} />
          </button>
        </>
      ) : null}
    </div>
  );
};
