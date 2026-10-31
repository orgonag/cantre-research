import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t } from '../i18n/index.js';

/** Native modal keeps the map inert, traps focus and supports Escape. Restore the
 * opener only on close; switching the contents must not restart the GPS/map. */
export function Sheet(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  opener?: HTMLElement | null;
  /** Asset inspection leaves the map interactive; other sheets remain modal. */
  modal?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  // Set focus and install Escape before the panel can be painted/interacted with.
  // A passive effect leaves a visible non-modal panel briefly unable to dismiss.
  useLayoutEffect(() => {
    const opener = props.opener ?? document.activeElement;
    const el = dialog.current;
    if (el instanceof HTMLDialogElement) el.showModal();
    else el?.querySelector<HTMLButtonElement>('button')?.focus();
    const escape = (event: KeyboardEvent) => {
      if (props.modal === false && event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      if (el instanceof HTMLDialogElement) el.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [props.modal]);
  const Panel = props.modal === false ? 'section' : 'dialog';
  return (
    <Panel
      role="dialog"
      ref={(element: HTMLElement | null) => {
        dialog.current = element;
      }}
      class={`hud-sheet ${props.modal === false ? 'asset-panel' : ''}`}
      aria-modal={props.modal === false ? 'false' : 'true'}
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
    >
      <div class="sheet-header">
        <h2 id="sheet-title">{props.title}</h2>
        <button type="button" onClick={props.onClose} aria-label={t('hud.close')}>
          ×
        </button>
      </div>
      <div class="sheet-body">{props.children}</div>
    </Panel>
  );
}
