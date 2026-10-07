import {Icon} from '@iconify/react';
import cx from 'classnames';
import {getDevicesMap} from 'common/deviceList';
import {useDispatch, useSelector} from 'react-redux';
import Popover from 'renderer/components/Popover';
import {
  selectActiveSuite,
  selectSuites,
  setActiveSuite,
  setSuiteDevices,
} from 'renderer/store/features/device-manager';
import {APP_VIEWS, setAppView} from 'renderer/store/features/ui';

/**
 * Suites as inline chips with an editor popover (Hybrid Studio design):
 * switching suites and changing which devices are in one no longer requires
 * opening the Device Manager.
 */
export const PreviewSuiteSelector = () => {
  const dispatch = useDispatch();
  const suites = useSelector(selectSuites);
  const activeSuite = useSelector(selectActiveSuite);
  const devicesMap = getDevicesMap();

  const activeDeviceIds = activeSuite.devices;
  const knownDevices = Object.values(devicesMap);

  const toggleDevice = (deviceId: string) => {
    const isMember = activeDeviceIds.includes(deviceId);
    // An empty suite renders no previews at all, so keep the last device.
    if (isMember && activeDeviceIds.length === 1) {
      return;
    }
    dispatch(
      setSuiteDevices({
        suite: activeSuite.id,
        devices: isMember
          ? activeDeviceIds.filter((id) => id !== deviceId)
          : [...activeDeviceIds, deviceId],
      })
    );
  };

  const count = `${activeDeviceIds.length} device${activeDeviceIds.length === 1 ? '' : 's'}`;
  return (
    <div className="flex flex-shrink-0 items-center" data-testid="suite-selector">
      <Popover
        triggerTitle={`Devices: ${activeSuite.name}, ${count}`}
        anchor="bottom end"
        triggerClassName="flex h-[30px] items-center gap-2 rounded-full border border-line px-[11px] text-[12.5px] text-fg transition-colors hover:bg-hover data-[open]:border-accent data-[open]:bg-accent-soft focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        className="w-[300px] p-[6px]"
        trigger={
          <span
            className="pointer-events-none flex items-center gap-2"
            data-testid="devices-button"
          >
            <Icon icon="lucide:monitor-smartphone" fontSize={15} />
            <span className="font-bold max-[1180px]:hidden">{activeSuite.name}</span>
            <span className="text-[11px] text-muted">
              <span className="min-[1181px]:hidden">{activeDeviceIds.length}</span>
              <span className="max-[1180px]:hidden">{count}</span>
            </span>
            <Icon icon="lucide:chevron-down" fontSize={12} className="text-muted" />
          </span>
        }
      >
        {({close}) => (
          <>
            <div className="px-[10px] pb-1 pt-2 text-[10.5px] font-bold tracking-[0.08em] text-muted">
              SUITE
            </div>
            {suites.map((suite) => {
              const isActive = suite.id === activeSuite.id;
              return (
                <button
                  key={suite.id}
                  type="button"
                  aria-pressed={isActive}
                  title={`${suite.name} suite`}
                  data-testid={`suite-chip-${suite.id}`}
                  onClick={() => dispatch(setActiveSuite(suite.id))}
                  className="flex w-full items-center gap-[10px] rounded-[7px] px-[10px] py-[7px] text-[13px] text-fg hover:bg-hover focus:outline-none focus-visible:bg-hover"
                >
                  <span className="pointer-events-none contents">
                    <Icon
                      icon="lucide:check"
                      fontSize={14}
                      className={cx('text-accent', {'opacity-0': !isActive})}
                    />
                    <span className={cx('truncate', {'font-bold': isActive})}>{suite.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted">
                      {suite.devices.length}
                    </span>
                  </span>
                </button>
              );
            })}
            <div className="mx-1 my-[6px] border-t border-line-soft" />
            <div className="px-[10px] pb-1 pt-2 text-[10.5px] font-bold tracking-[0.08em] text-muted">
              DEVICES IN “{activeSuite.name.toUpperCase()}”
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {knownDevices.map((device) => {
                const isMember = activeDeviceIds.includes(device.id);
                return (
                  <button
                    key={device.id}
                    type="button"
                    aria-pressed={isMember}
                    onClick={() => toggleDevice(device.id)}
                    className="flex w-full items-center gap-[10px] rounded-[7px] px-[10px] py-[7px] text-[13px] text-fg hover:bg-hover focus:outline-none focus-visible:bg-hover"
                  >
                    <span className="pointer-events-none contents">
                      <span
                        className={cx(
                          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[5px] border-[1.5px]',
                          isMember ? 'border-accent bg-accent' : 'border-line'
                        )}
                      >
                        <Icon
                          icon="ic:round-check"
                          fontSize={12}
                          className={cx('text-on-accent', {'opacity-0': !isMember})}
                        />
                      </span>
                      <span className="truncate">{device.name}</span>
                      <span className="ml-auto flex-shrink-0 font-mono text-[11px] text-muted">
                        {device.width}×{device.height}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mx-1 my-[6px] border-t border-line-soft" />
            <button
              type="button"
              onClick={() => {
                close();
                dispatch(setAppView(APP_VIEWS.DEVICE_MANAGER));
              }}
              className="flex w-full items-center gap-2 rounded-[7px] px-[10px] py-2 text-[13.5px] text-fg hover:bg-hover focus:outline-none focus-visible:bg-hover"
            >
              <span className="pointer-events-none contents">
                <Icon icon="heroicons:swatch" fontSize={15} className="text-accent" />
                Manage suites &amp; devices
              </span>
            </button>
          </>
        )}
      </Popover>
    </div>
  );
};
