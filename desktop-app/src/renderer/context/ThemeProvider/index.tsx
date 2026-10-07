import React, {useEffect} from 'react';
import {useSelector} from 'react-redux';
import {selectDarkMode, selectPalette} from 'renderer/store/features/ui';

const ThemeProvider = ({children}: {children: React.ReactNode}) => {
  const darkMode = useSelector(selectDarkMode);
  const palette = useSelector(selectPalette);

  useEffect(() => {
    document.body.classList.add('bg-bg', 'text-fg');
  }, []);

  useEffect(() => {
    // data-theme drives the Hybrid Studio token palette; the `dark` class
    // keeps the legacy Tailwind dark: variants working until they are
    // collapsed into semantic classes.
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.dataset.palette = palette;
  }, [darkMode, palette]);

  return <>{children}</>;
};

export default ThemeProvider;
