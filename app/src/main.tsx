import { render } from 'preact';
import { setLang } from './i18n/index.js';
import { lockFlagIn } from './logic/lockFlag.js';
import { loadSettings } from './logic/settings.js';
import { App } from './ui/App.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';
import './style.css';

/**
 * Entry point. Reads the settings, reads and clears the "a lock was set" flag (D6: the lock
 * does not survive a reload, and the app says so), then mounts the layout inside the error
 * boundary. No network request is made here.
 */
const settings = loadSettings(undefined, navigator.language);
setLang(settings.lang);
document.documentElement.lang = settings.lang;
const lockClearedOnReload = lockFlagIn().consume();

const root = document.getElementById('app');
if (root !== null) {
  render(
    <ErrorBoundary>
      <App session={null} lockClearedOnReload={lockClearedOnReload} />
    </ErrorBoundary>,
    root,
  );
}
