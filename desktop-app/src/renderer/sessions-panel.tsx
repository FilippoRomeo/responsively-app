import {createRoot} from 'react-dom/client';
import {useEffect, useState} from 'react';
import {SessionInfo, SessionRequest} from '../common/sessions';
import SessionsManager from './components/Sessions';
import usePageVisible from './hooks/usePageVisible';
import './App.css';

declare global {
  interface Window {
    sessionsPanel: {
      context: () => {darkMode: boolean; create: boolean; error: string};
      request: (value: SessionRequest) => Promise<SessionInfo | SessionInfo[]>;
      dismiss: () => void;
      resize: (height: number) => void;
      onShow: (
        callback: (value: {create: boolean; error: string; darkMode: boolean}) => void
      ) => () => void;
    };
  }
}

const context = window.sessionsPanel.context();
const applyTheme = (darkMode: boolean) => {
  document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', darkMode);
};
applyTheme(context.darkMode);
document.body.classList.add('bg-panel', 'text-fg');
const root = createRoot(document.getElementById('root')!);
const Panel = () => {
  const [showRequest, setShowRequest] = useState<{create: boolean; error: string} | null>(null);
  // The panel is hidden on blur, not closed: poll the controller only while it is visible.
  const visible = usePageVisible();
  useEffect(
    () =>
      window.sessionsPanel.onShow((value) => {
        applyTheme(value.darkMode);
        setShowRequest({create: value.create, error: value.error});
      }),
    []
  );
  return (
    <SessionsManager
      request={window.sessionsPanel.request}
      onClose={window.sessionsPanel.dismiss}
      initialCreate={context.create}
      initialError={context.error}
      showRequest={showRequest}
      active={visible}
      native
      onHeight={window.sessionsPanel.resize}
    />
  );
};
root.render(<Panel />);
