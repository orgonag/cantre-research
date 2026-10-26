import type { NetworkAsset } from '@cantre/core';
import type { AssetDetails } from '@cantre/data-client';
import { t } from '../i18n/index.js';
import { assetSource } from '../logic/present.js';

/** A tapped feature on its own, or the visible map list when opened from the menu. */
export function VisibleAssets(props: {
  assets: readonly NetworkAsset[];
  details: AssetDetails | null;
  selected: string | null;
}) {
  return (
    <>
      {props.selected === null && <p>{t('hud.assetLimit')}</p>}
      <ul class="plain">
        {props.assets.map((asset) => {
          const source = assetSource(props.details, asset.id);
          return (
            <li key={asset.id}>
              <details open={asset.id === props.selected}>
                <summary>
                  {asset.name ? `${asset.name} · ` : ''}
                  {t(`asset.kind.${asset.kind}`)}
                </summary>
                {asset.posted && (
                  <p>
                    {t('asset.posted', { value: String(asset.posted.mp) })} ·{' '}
                    {asset.posted.subdivisionNid} · {asset.posted.tier}
                  </p>
                )}
                {source.kind === 'found' ? (
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
                ) : (
                  <p>{t('asset.noSource')}</p>
                )}
              </details>
            </li>
          );
        })}
      </ul>
      {props.assets.length === 0 && <p>{t('asset.none')}</p>}
    </>
  );
}
