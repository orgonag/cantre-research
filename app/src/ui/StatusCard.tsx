import { t } from '../i18n/index.js';
import type { CardModel } from '../logic/present.js';
import { LockChip } from './LockChip.js';

/**
 * The status card (spec §7): text first, every value from the {@link CardModel}. Shows the
 * headline status, the lock chip, subdivision / operator / track class, the milepost or range
 * or the reason there is none, the GPS band (labelled "from GPS accuracy only"), the uncertainty
 * fields, the anchors with their tier (an unverified tier gets a visible warning) and the data
 * vintage. A STALE card is marked historical in its heading text and by a distinct style, so it
 * is never mistaken for a live one. There is no probability or confidence figure anywhere.
 */
export function StatusCard(props: { readonly model: CardModel; readonly onUnlock: () => void }) {
  const { model, onUnlock } = props;
  const details: readonly (readonly [string, string | null])[] = [
    [t('card.label.subdivision'), model.subdivision],
    [t('card.label.operator'), model.operator],
    [t('card.label.trackClass'), model.trackClass],
  ];
  const meta = [model.fixAgeText, model.accuracyText, model.residualText].filter(
    (x): x is string => x !== null,
  );
  return (
    <section
      class={model.historical ? 'card card--historical' : 'card'}
      aria-labelledby="card-headline"
    >
      <div class="card__top">
        <h3 id="card-headline" class="card__headline">
          {model.headline}
        </h3>
        <LockChip lockText={model.lockText} onUnlock={onUnlock} />
      </div>

      <dl class="card__facts">
        {details.map(
          ([label, value]) =>
            value !== null && (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ),
        )}
      </dl>

      {model.mpText !== null && <p class="card__mp">{model.mpText}</p>}
      {model.rangeText !== null && <p class="card__mp">{model.rangeText}</p>}
      {model.bandText !== null && <p>{model.bandText}</p>}
      {model.mpNote !== null && <p class="muted">{model.mpNote}</p>}
      {model.tierBadge !== null && model.tierText !== null && (
        <p class={`badge badge--${model.tierBadge}`}>{model.tierText}</p>
      )}

      {meta.length > 0 && <p class="card__meta">{meta.join(' · ')}</p>}
      {model.anchorsText !== null && <p class="card__meta">{model.anchorsText}</p>}
      {model.alsoFitText !== null && <p class="notice">{model.alsoFitText}</p>}

      {model.reasons.length > 0 && (
        <ul class="reasons">
          {model.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p class="muted card__vintage">{model.vintageText}</p>
    </section>
  );
}
