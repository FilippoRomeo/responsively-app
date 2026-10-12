import {Icon} from '@iconify/react';
import {IconButton} from '../ToolBar/primitives';
import {setTerminalOpen, useTerminalOpen} from './store';

const TerminalButton = () => {
  const open = useTerminalOpen();
  return (
    <IconButton title="Terminal" isActive={open} onClick={() => setTerminalOpen(!open)}>
      <Icon icon="lucide:terminal-square" fontSize={15} />
    </IconButton>
  );
};

export default TerminalButton;
