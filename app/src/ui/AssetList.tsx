import { useState } from 'preact/hooks';
import type { AssetDetails } from '@cantre/data-client';
import { t } from '../i18n/index.js';
import { assetSource } from '../logic/present.js';
import type { AssetRow } from '../logic/present.js';

/**
 * Nearby assets, nearest first (spec §7). Each row is a button that opens that asset's source
 * attributes from memory (the asset-details file loaded with the snapshot); nothing is fetched.
 * An asset with no entry in the details shows a typed "no source attributes" message.
 */
export function AssetList(props: {
  readonly rows: readonly AssetRow[];
  readonly details: AssetDetails | null;
}) {
  const { rows, details } = props;
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section class="assets" aria-labelledby="assets-heading">
      <h3 id="assets-heading">{t('asset.heading')}</h3>
      {rows.length === 0 ? (
        <p>{t('asset.none')}</p>
      ) : (
        <>
          <ul class="plain">
            {rows.map((row) => {
              const open = openId === row.id;
              const source = open ? assetSource(details, row.id) : null;
              const panelId = `asset-source-${row.id}`;
              return (
                <li key={row.id} class="asset">
                  <button
                    type="button"
                    class="asset__toggle"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => {
                      setOpenId(open ? null : row.id);
                    }}
                  >
                    <span class="asset__side">{row.sideText}</span>
                    <span class="asset__name">{row.name}</span>
                    <span class="asset__dist">{row.distanceText}</span>
                  </button>
                  <p class="asset__mileage muted">
                    {row.kindText}
                    {row.postedText !== null && <> · {row.postedText}</>}
                    {row.derivedText !== null && <> · {row.derivedText}</>}
                    {row.noMileageText !== null && <> · {row.noMileageText}</>}
                  </p>
                  <div id={panelId} hidden={!open}>
                    {source?.kind === 'found' && (
                      <>
                        <p>{t('asset.sourceLayer', { layer: source.layer })}</p>
                        <dl class="attrs">
                          {source.attrs.map(([k, v]) => (
                            <div key={k}>
                              <dt>{k}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </>
                    )}
                    {source?.kind === 'missing' && <p>{t('asset.noSource')}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p class="muted">{t('asset.listNote')}</p>
        </>
      )}
    </section>
  );
}
