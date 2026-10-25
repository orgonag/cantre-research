/** The parts of `document` that `onResume` uses. */
export type VisibilityDoc = {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

/**
 * Call `callback` each time the page becomes visible again (phone unlocked, tab reopened).
 * The app re-renders from `session.result(Date.now())` then, so a long-backgrounded page shows
 * `STALE` (historical), never an old fix as if it were current (Review Focus 3).
 * Returns a function that stops listening.
 */
export function onResume(doc: VisibilityDoc, callback: () => void): () => void {
  const listener = (): void => {
    if (doc.visibilityState === 'visible') {
      callback();
    }
  };
  doc.addEventListener('visibilitychange', listener);
  return () => {
    doc.removeEventListener('visibilitychange', listener);
  };
}
