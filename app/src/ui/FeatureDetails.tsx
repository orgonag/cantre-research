import type { NetworkAsset, NetworkView } from '@cantre/core';
import type { AssetDetails } from '@cantre/data-client';
import { getLang, t } from '../i18n/index.js';
import { assetSource } from '../logic/present.js';
import { featureFields, featureLocations } from '../logic/assetDetails.js';

/** A readable summary backed by the installed record; no per-feature requests. */
export function FeatureDetails(props: {
  asset: NetworkAsset;
  net: NetworkView;
  details: AssetDetails | null;
}) {
  const { asset, net, details } = props;
  const source = assetSource(details, asset.id);
  const fields = featureFields(source.kind === 'found' ? source.attrs : []);
  const locations = featureLocations(asset, net);
  const number = new Intl.NumberFormat(getLang(), { maximumFractionDigits: 3 });
  return (
    <div class="feature-details">
      <dl class="feature-facts">
        <div>
          <dt>{t('feature.assetType')}</dt>
          <dd>{t(`asset.kind.${asset.kind}`)}</dd>
        </div>
      </dl>
      {locations.length ? (
        locations.map((location) => (
          <dl class="feature-facts" key={location.key}>
            <div>
              <dt>{t('feature.subdivision')}</dt>
              <dd>{location.subdivision}</dd>
            </div>
            {location.mileposts.length ? (
              location.mileposts.map((mp) => (
                <div key={`${mp.label}-${String(mp.value)}`}>
                  <dt>{mp.label}</dt>
                  <dd>MP {number.format(mp.value)}</dd>
                </div>
              ))
            ) : (
              <div>
                <dt>{t('feature.milepost')}</dt>
                <dd>{t('feature.notRecorded')}</dd>
              </div>
            )}
          </dl>
        ))
      ) : (
        <dl class="feature-facts">
          <div>
            <dt>{t('feature.subdivision')}</dt>
            <dd>{t('feature.notRecorded')}</dd>
          </div>
          <div>
            <dt>{t('feature.milepost')}</dt>
            <dd>{t('feature.notRecorded')}</dd>
          </div>
        </dl>
      )}
      <dl class="feature-facts">
        {fields.map((field) => (
          <div key={field.key}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
        {asset.kind === 'crossing' && !fields.some((f) => f.key === 'TCID') && (
          <div>
            <dt>{t('feature.tcid')}</dt>
            <dd>{t('feature.notRecorded')}</dd>
          </div>
        )}
      </dl>
      <p class="muted">{t('feature.sourceNote')}</p>
      <details class="feature-source">
        <summary>{t('feature.sourceRecord')}</summary>
        <p>
          <a
            href="https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8"
            target="_blank"
            rel="noreferrer"
          >
            National Railway Network (NRWN)
          </a>
        </p>
        <dl class="feature-facts">
          <div>
            <dt>{t('feature.recordId')}</dt>
            <dd>{asset.id}</dd>
          </div>
          <div>
            <dt>{t('feature.dataset')}</dt>
            <dd>{net.datasetVersion}</dd>
          </div>
        </dl>
        {source.kind === 'found' ? (
          <>
            <p>{t('asset.sourceLayer', { layer: source.layer })}</p>
            <dl class="feature-facts">
              {source.attrs.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p>{t('asset.noSource')}</p>
        )}
      </details>
    </div>
  );
}
