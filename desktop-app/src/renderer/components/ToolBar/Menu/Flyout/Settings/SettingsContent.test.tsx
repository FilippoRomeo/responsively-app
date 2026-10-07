import * as React from 'react';

import {render, fireEvent, waitFor} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';

import {IPC_MAIN_CHANNELS} from 'common/constants';
import {uiSlice} from 'renderer/store/features/ui';
import {SettingsContent} from './SettingsContent';

const mockOnClose = vi.fn();

describe('SettingsContentHeader', () => {
  const store = configureStore({reducer: {ui: uiSlice.reducer}});
  const renderComponent = () =>
    render(
      <Provider store={store}>
        <SettingsContent onClose={mockOnClose} />
      </Provider>
    );

  it('Accept-Language is saved to store', () => {
    const {getByTestId} = renderComponent();

    const acceptLanguageInput = getByTestId('settings-accept_language-input');
    const screenshotLocationInput = getByTestId('settings-screenshot_location-input');
    const popupBehaviorSelect = getByTestId('settings-popup_behavior-select');
    const saveButton = getByTestId('settings-save-button');

    fireEvent.change(acceptLanguageInput, {target: {value: 'cz-Cz'}});
    fireEvent.change(screenshotLocationInput, {
      target: {value: './path/location'},
    });
    fireEvent.change(popupBehaviorSelect, {target: {value: 'external'}});
    fireEvent.click(saveButton);

    expect(window.electron.store.set).toHaveBeenNthCalledWith(
      1,
      'userPreferences.screenshot.saveLocation',
      './path/location'
    );
    expect(window.electron.store.set).toHaveBeenNthCalledWith(
      2,
      'userPreferences.webRequestHeaderAcceptLanguage',
      'cz-Cz'
    );
    expect(window.electron.store.set).toHaveBeenNthCalledWith(
      3,
      'userPreferences.popupBehavior',
      'external'
    );

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('Reset toolbar switches to the classic toolbar and back', () => {
    const {getByTestId} = renderComponent();
    const reset = getByTestId('settings-toolbar-reset');
    expect(reset).toHaveTextContent('Reset toolbar');
    fireEvent.click(reset);
    expect(store.getState().ui.classicToolbar).toBe(true);
    expect(reset).toHaveTextContent('Use the icon toolbar');
    fireEvent.click(reset);
    expect(store.getState().ui.classicToolbar).toBe(false);
  });

  it('Clear everything clears this window and counts down to what is left', async () => {
    const full = {cache: 48.2e6, cookies: 37, cookieBytes: 18e3, storage: 9.6e6, serviceWorkers: 0};
    const empty = {cache: 0, cookies: 0, cookieBytes: 0, storage: 4e3, serviceWorkers: 0};
    vi.mocked(window.electron.ipcRenderer.invoke).mockImplementation(async (channel: string) => {
      if (channel === IPC_MAIN_CHANNELS.WINDOW_DATA_CLEAR) return empty;
      return channel === IPC_MAIN_CHANNELS.WINDOW_DATA_USAGE ? full : undefined;
    });
    const {getByTestId} = renderComponent();
    const card = getByTestId('settings-window-data');
    await waitFor(() => expect(card).toHaveTextContent('57.8 MB'));
    expect(card).toHaveTextContent('37 · 18 KB');

    fireEvent.click(getByTestId('settings-clear-window-data'));
    await waitFor(() => expect(card).toHaveTextContent('4 KB — cleared'), {timeout: 3000});
    expect(card).toHaveTextContent('0 · 0 B');
    expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_MAIN_CHANNELS.WINDOW_DATA_CLEAR
    );
    vi.mocked(window.electron.ipcRenderer.invoke).mockReset();
  });
});
