import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n/index.js';

/** The lit state describes a held browser lock, not just a user's request. */
export function WakeButton() {
  const wanted = useRef(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  const sequence = useRef(0);
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const acquire = async () => {
    const seq = ++sequence.current;
    try {
      const next = await navigator.wakeLock.request('screen');
      if (seq !== sequence.current || !wanted.current) {
        await next.release();
        return;
      }
      lock.current = next;
      setActive(true);
      setFailed(false);
      next.addEventListener('release', () => {
        if (lock.current === next) {
          lock.current = null;
          setActive(false);
        }
      });
    } catch {
      if (seq === sequence.current) {
        setActive(false);
        setFailed(true);
      }
    }
  };
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible' && wanted.current && lock.current === null)
        void acquire();
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      wanted.current = false;
      sequence.current++;
      document.removeEventListener('visibilitychange', resume);
      void lock.current?.release();
    };
  }, []);
  return (
    <>
      <button
        type="button"
        class={`hud-icon ${active ? 'is-active' : ''}`}
        disabled={!supported}
        title={t(supported ? 'hud.wake' : 'hud.wakeUnsupported')}
        aria-label={t(supported ? 'hud.wake' : 'hud.wakeUnsupported')}
        aria-pressed={active}
        onClick={() => {
          wanted.current = !wanted.current;
          if (wanted.current) void acquire();
          else {
            sequence.current++;
            void lock.current?.release();
            setActive(false);
            setFailed(false);
          }
        }}
      >
        ☼
      </button>
      {failed && (
        <span class="visually-hidden" role="status">
          {t('hud.wakeFailed')}
        </span>
      )}
    </>
  );
}
