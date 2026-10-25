import { useMemo, useState } from 'preact/hooks';
import type { NetworkView } from '@cantre/core';
import { t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';
import { findBySubdivision, parseMilepost, pinText, subdivisionsOf } from '../logic/find.js';
import type { Pin } from '../logic/find.js';

type Outcome =
  | { readonly kind: 'pins'; readonly mp: number; readonly pins: readonly Pin[] }
  | { readonly kind: 'message'; readonly key: MessageKey };

/**
 * Find a location by subdivision and milepost (spec §7). It works with no GPS and with no map:
 * the result is text that lists each pin's subdivision, milepost, latitude and longitude. The
 * map is never the only way to get the information; "Show on map" is an extra.
 *
 * The form has real labels and works from the keyboard. A milepost that falls in a gap between
 * calibrated ranges gives a plain message, never an extrapolated position. Nothing typed here is
 * stored or sent.
 */
export function FindLocation(props: {
  readonly net: NetworkView;
  /** Show the found pins on the map. Omitted when there is no map. */
  readonly onShowOnMap?: (pins: readonly Pin[]) => void;
}) {
  const { net, onShowOnMap } = props;
  const subdivisions = useMemo(() => subdivisionsOf(net), [net]);
  const [nid, setNid] = useState('');
  const [mpText, setMpText] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const submit = (event: Event): void => {
    event.preventDefault();
    if (nid === '') {
      setOutcome({ kind: 'message', key: 'find.needSubdivision' });
      return;
    }
    const mp = parseMilepost(mpText);
    if (mp === null) {
      setOutcome({ kind: 'message', key: 'find.invalidMp' });
      return;
    }
    const found = findBySubdivision(net, nid, mp);
    setOutcome(
      found.kind === 'pins'
        ? { kind: 'pins', mp, pins: found.pins }
        : { kind: 'message', key: found.messageKey },
    );
  };

  return (
    <section class="find" aria-labelledby="find-heading">
      <h3 id="find-heading">{t('find.heading')}</h3>
      <p class="muted">{t('find.intro')}</p>
      {subdivisions.length === 0 ? (
        <p>{t('find.noSubdivisions')}</p>
      ) : (
        <form onSubmit={submit} noValidate>
          <div class="field">
            <label for="find-sub">{t('find.subdivision')}</label>
            <select
              id="find-sub"
              value={nid}
              onChange={(e) => {
                setNid(e.currentTarget.value);
              }}
            >
              <option value="">{t('find.choose')}</option>
              {subdivisions.map((s) => (
                <option key={s.nid} value={s.nid}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="find-mp">{t('find.milepost')}</label>
            <input
              id="find-mp"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={mpText}
              onInput={(e) => {
                setMpText(e.currentTarget.value);
              }}
            />
          </div>
          <button type="submit">{t('find.go')}</button>
        </form>
      )}
      <div class="find__result" role="status">
        {outcome?.kind === 'message' && <p>{t(outcome.key)}</p>}
        {outcome?.kind === 'pins' && (
          <>
            <h4>{t('find.results')}</h4>
            <ul class="plain">
              {outcome.pins.map((pin) => (
                <li key={`${pin.chainId}/${pin.intervalId}`}>{pinText(pin, outcome.mp)}</li>
              ))}
            </ul>
            <p class="muted">{t('find.pinNote')}</p>
            {onShowOnMap !== undefined && (
              <button
                type="button"
                onClick={() => {
                  onShowOnMap(outcome.pins);
                }}
              >
                {t('find.showOnMap')}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
