import { t } from '../i18n/index.js';

/**
 * The route lock chip: "Route: auto", or "Locked: <subdivision>" with an Unlock button.
 * The button is always present while a lock exists, including on LOCK_CONFLICT, so a lock can
 * never be stuck. Renders only what `present()` produced (`lockText`).
 */
export function LockChip(props: {
  readonly lockText: string | null;
  readonly onUnlock: () => void;
}) {
  const { lockText, onUnlock } = props;
  if (lockText === null) {
    return <span class="chip chip--auto">{t('lock.auto')}</span>;
  }
  return (
    <span class="chip chip--locked">
      <span>{lockText}</span>
      <button type="button" class="chip__button" onClick={onUnlock}>
        {t('lock.unlock')}
      </button>
    </span>
  );
}
