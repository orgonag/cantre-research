import type { NetworkAsset, NetworkView } from '@cantre/core';
import type { AssetDetails } from '@cantre/data-client';
import { t } from '../i18n/index.js';
import { FeatureDetails } from './FeatureDetails.js';

/** A tapped feature on its own, or the visible map list when opened from the menu. */
export function VisibleAssets(props: {
  assets: readonly NetworkAsset[];
  details: AssetDetails | null;
  selected: string | null;
  net: NetworkView;
}) {
  return (
    <>
      {props.selected === null && <p>{t('hud.assetLimit')}</p>}
      <ul class="plain">
        {props.assets.map((asset) => {
          return (
            <li key={asset.id}>
              {asset.id === props.selected ? (
                <FeatureDetails asset={asset} net={props.net} details={props.details} />
              ) : (
                <details>
                  <summary>
                    {asset.name ? `${asset.name} · ` : ''}
                    {t(`asset.kind.${asset.kind}`)}
                  </summary>
                  <FeatureDetails asset={asset} net={props.net} details={props.details} />
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {props.assets.length === 0 && <p>{t('asset.none')}</p>}
    </>
  );
}
