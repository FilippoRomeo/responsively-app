import {Icon} from '@iconify/react';
import {useEffect, useState} from 'react';
import {
  onPreviewsSchemeChange,
  previewsScheme,
  setPreviewsScheme,
} from 'renderer/components/Previewer/Device/scheme';
import {IconButton, ToolbarAction} from '../primitives';

/** Classic toolbar: dark or light previews on every device (Appearance has the full choice). */
const ColorSchemeToggle = ({iconOnly = false}: {iconOnly?: boolean}) => {
  const [dark, setDark] = useState(previewsScheme() === 'dark');
  useEffect(() => onPreviewsSchemeChange(() => setDark(previewsScheme() === 'dark')), []);
  const Button = iconOnly ? IconButton : ToolbarAction;

  return (
    <Button
      onClick={() => setPreviewsScheme(dark ? 'light' : 'dark')}
      isActive={dark}
      title="Device theme color toggle"
    >
      <Icon icon={dark ? 'carbon:moon' : 'carbon:sun'} fontSize={15} />
      {iconOnly ? null : 'Scheme'}
    </Button>
  );
};

export default ColorSchemeToggle;
