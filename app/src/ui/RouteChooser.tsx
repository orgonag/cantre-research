import type { Lock } from '@cantre/core';
import { t } from '../i18n/index.js';
import type { Choice, SingleRoute } from '../logic/present.js';

/**
 * The route chooser for AMBIGUOUS_ROUTE and LOCK_CONFLICT (spec §7): each plausible route with
 * its operator, subdivision, track class and cross-track residual. Choosing one asks the app to
 * lock to it; nothing is chosen for the user. The residual is a distance to the track, not a
 * probability, and the heading says choosing does not make the GPS more precise.
 */
export function RouteChooser(props: {
  readonly choices: readonly Choice[];
  readonly conflict: boolean;
  /** Set when fewer than two routes are listed: the help text must not claim that more than one fits. */
  readonly singleRoute?: SingleRoute | null;
  readonly onChoose: (lock: Lock) => void;
}) {
  const { choices, conflict, singleRoute = null, onChoose } = props;
  if (choices.length === 0) {
    return null;
  }
  // "More than one route fits" only when two or more routes are listed.
  const helpKey = conflict
    ? 'route.conflictHelp'
    : singleRoute === 'partial'
      ? 'route.partialHelp'
      : singleRoute === 'diamond'
        ? 'route.diamondHelp'
        : singleRoute === 'other'
          ? 'route.singleHelp'
          : 'route.help';
  return (
    <section class="chooser" aria-labelledby="chooser-heading">
      <h3 id="chooser-heading">{t('route.heading')}</h3>
      <p>{t(helpKey)}</p>
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
