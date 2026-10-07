import {Icon} from '@iconify/react';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {SetNativeThemeArgs, SetNativeThemeResult} from 'main/native-functions';
import {useState} from 'react';
import {IconButton, ToolbarAction} from '../primitives';

const ColorSchemeToggle = ({iconOnly = false}: {iconOnly?: boolean}) => {
  const [isDarkColorScheme, setIsDarkColorScheme] = useState<boolean>(false);
  const Button = iconOnly ? IconButton : ToolbarAction;

  return (
    <Button
      onClick={() => {
        window.electron.ipcRenderer.invoke<SetNativeThemeArgs, SetNativeThemeResult>(
          IPC_MAIN_CHANNELS.SET_NATIVE_THEME,
          {
            theme: isDarkColorScheme ? 'light' : 'dark',
          }
        );
        setIsDarkColorScheme(!isDarkColorScheme);
      }}
      isActive={isDarkColorScheme}
      title="Device theme color toggle"
    >
      <Icon icon={isDarkColorScheme ? 'carbon:moon' : 'carbon:sun'} fontSize={15} />
      {iconOnly ? null : 'Scheme'}
    </Button>
  );
};

export default ColorSchemeToggle;
