import {Icon} from '@iconify/react';
import useClickOutside from 'renderer/hooks/useClickOutside';
import Button from 'renderer/components/Button';
import {useDispatch, useSelector} from 'react-redux';
import {
  closeMenuFlyout,
  selectClassicToolbar,
  selectMenuFlyout,
  selectToolbarLayout,
} from 'renderer/store/features/ui';
import MenuFlyout from './Flyout';

const Menu = () => {
  const dispatch = useDispatch();
  const isMenuFlyoutOpen = useSelector(selectMenuFlyout);
  const hiddenCount = useSelector(selectToolbarLayout).hidden.length;
  const classic = useSelector(selectClassicToolbar);

  const ref = useClickOutside(() => {
    if (!isMenuFlyoutOpen) {
      return;
    }
    dispatch(closeMenuFlyout(false));
  });

  const handleFlyout = () => {
    dispatch(closeMenuFlyout(!isMenuFlyoutOpen));
  };

  const onClose = () => {
    dispatch(closeMenuFlyout(false));
  };

  return (
    <div className="relative mr-2 flex items-center" ref={ref}>
      <Button onClick={handleFlyout} isActive={isMenuFlyoutOpen} data-testid="menu-button">
        <Icon icon="carbon:overflow-menu-vertical" />
      </Button>
      {hiddenCount > 0 && !classic ? (
        <span
          data-testid="hidden-tools-count"
          title={`${hiddenCount} hidden toolbar button${hiddenCount === 1 ? '' : 's'}: ⋮ › More tools`}
          className="pointer-events-none absolute -right-[2px] -top-[2px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-accent px-[3px] text-[9px] font-bold text-on-accent"
        >
          {hiddenCount}
        </span>
      ) : null}
      <div style={{visibility: isMenuFlyoutOpen ? 'visible' : 'hidden'}}>
        <MenuFlyout closeFlyout={onClose} />
      </div>
    </div>
  );
};

export default Menu;
