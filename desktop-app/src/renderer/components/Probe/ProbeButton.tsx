import {Icon} from '@iconify/react';
import {IconButton} from '../ToolBar/primitives';
import {setProbeOpen, useProbeOpen} from './store';

const ProbeButton = () => {
  const open = useProbeOpen();
  return (
    <IconButton title="Test probe" isActive={open} onClick={() => setProbeOpen(!open)}>
      <Icon icon="lucide:gauge" fontSize={15} />
    </IconButton>
  );
};

export default ProbeButton;
