import { useEffect, useRef, useState } from 'preact/hooks';
import { announce } from '../logic/present.js';
import type { CardModel } from '../logic/present.js';

/**
 * The ARIA live region (spec §7): speaks the status and milepost text when it changes, at most
 * once every 10 s. The rule lives in `announce()`; this component only keeps what was last said
 * and when. `nowMs` comes from the app's clock tick, so the component reads no clock itself.
 * `aria-live="polite"` so it never interrupts the user; `aria-atomic` so the whole sentence is read.
 */
export function LiveRegion(props: { readonly model: CardModel; readonly nowMs: number }) {
  const { model, nowMs } = props;
  const last = useRef<{ atMs: number; text: string } | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const text = announce(model, last.current?.atMs ?? null, nowMs, last.current?.text ?? null);
    if (text !== null) {
      last.current = { atMs: nowMs, text };
      setMessage(text);
    }
  }, [model, nowMs]);

  return (
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
