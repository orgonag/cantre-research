import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t } from '../i18n/index.js';

/** Native modal keeps the map inert, traps focus and supports Escape. Restore the
 * opener only on close; switching the contents must not restart the GPS/map. */
export function Sheet(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  opener?: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const opener = props.opener ?? document.activeElement;
    const el = dialog.current;
    el?.showModal();
    return () => {
      el?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      class="hud-sheet"
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
      {props.children}
    </dialog>
  );
}
