import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import { errorCode } from '../logic/errorCode.js';
import { t } from '../i18n/index.js';

/**
 * Catches any error thrown while rendering and shows its code with a "Reset" button that
 * reloads the app (spec §8: no exception reaches the user as a blank screen).
 *
 * Only the code is shown. No stack trace, message or value is displayed, logged or sent.
 */
export class ErrorBoundary extends Component<
  { readonly children: ComponentChildren },
  { readonly code: string | null }
> {
  override state: { readonly code: string | null } = { code: null };

  static override getDerivedStateFromError(error: unknown): { readonly code: string } {
    return { code: errorCode(error) };
  }

  override render(): ComponentChildren {
    const { code } = this.state;
    if (code === null) {
      return this.props.children;
    }
    return (
      <div class="error-screen" role="alert">
        <h1>{t('boundary.title')}</h1>
        <p>
          {t('boundary.body')} <span class="error-code">{code}</span>
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t('boundary.reset')}
        </button>
      </div>
    );
  }
}
