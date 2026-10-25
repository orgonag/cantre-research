import type { Lock } from '@cantre/core';
import { t } from '../i18n/index.js';
import type { Choice } from '../logic/present.js';

/**
 * The route chooser for AMBIGUOUS_ROUTE and LOCK_CONFLICT (spec §7): each plausible route with
 * its operator, subdivision, track class and cross-track residual. Choosing one asks the app to
 * lock to it; nothing is chosen for the user. The residual is a distance to the track, not a
 * probability, and the heading says choosing does not make the GPS more precise.
 */
export function RouteChooser(props: {
  readonly choices: readonly Choice[];
  readonly conflict: boolean;
  readonly onChoose: (lock: Lock) => void;
}) {
  const { choices, conflict, onChoose } = props;
  if (choices.length === 0) {
    return null;
  }
  return (
    <section class="chooser" aria-labelledby="chooser-heading">
      <h3 id="chooser-heading">{t('route.heading')}</h3>
      <p>{t(conflict ? 'route.conflictHelp' : 'route.help')}</p>
      <ul class="plain">
        {choices.map((c) => (
          <li key={c.key} class="chooser__item">
            <span class="chooser__text">
              <strong>{c.subdivision}</strong> · {c.operator} · {c.trackClass} · {c.residualText}
            </span>
            {c.lock === null ? (
              <span class="muted">{t('route.notLockable')}</span>
            ) : (
              <button
                type="button"
                aria-label={t('route.chooseAria', {
                  subdivision: c.subdivision,
                  operator: c.operator,
                })}
                onClick={() => {
                  if (c.lock !== null) {
                    onChoose(c.lock);
                  }
                }}
              >
                {t('route.choose')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
