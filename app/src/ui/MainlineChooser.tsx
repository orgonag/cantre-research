import type { Lock } from '@cantre/core';
import { getLang, t } from '../i18n/index.js';
import type { mainlines } from '../logic/mainlines.js';

export function MainlineChooser(props: {
  choices: ReturnType<typeof mainlines>['choices'];
  lock: Lock | null;
  units: 'mi' | 'km';
  onChoose: (lock: Lock) => void;
  onAuto: () => void;
}) {
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  return (
    <section class="chooser" aria-label={t('mainline.heading')}>
      <button type="button" aria-pressed={props.lock === null} onClick={props.onAuto}>
        {t('mainline.auto')}
      </button>
      <p>{t('mainline.help')}</p>
      {!props.choices.length && <p>{t('hud.noRoutes')}</p>}
      <ul class="plain">
        {props.choices.map((option) => {
          const c = option.candidate;
          const base = c.chainBaseId ?? c.chainId;
          return (
            <li key={option.key} class="chooser__item">
              <div class="chooser__text">
                <strong>{c.subdivisionName}</strong> · {c.operator}
                <p>
                  {t('mainline.distance', {
                    distance: number(c.residualM / (props.units === 'mi' ? 1609.344 : 1000), 2),
                    unit: props.units,
                  })}
                </p>
                <p>
                  {option.milepost?.kind === 'calibrated'
                    ? `MP ${number(option.milepost.mp, 3)} · ${t('hud.calculated')}`
                    : t('hud.noTrackMp')}
                  {option.tier === 'unverified' ? ` · ${t('mainline.unverified')}` : ''}
                </p>
              </div>
              {base === null ? (
                <span class="muted">{t('route.notLockable')}</span>
              ) : (
                <button
                  type="button"
                  aria-pressed={option.selected}
                  aria-label={t('route.chooseAria', {
                    subdivision: c.subdivisionName,
                    operator: c.operator,
                  })}
                  onClick={() => {
                    props.onChoose({ kind: 'chain', chainId: base });
                  }}
                >
                  {t(option.selected ? 'mainline.selected' : 'route.choose')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
