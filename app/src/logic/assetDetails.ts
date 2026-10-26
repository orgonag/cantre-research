import type { NetworkAsset, NetworkView } from '@cantre/core';
import { t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';

/** Public NRWN column labels. Preserve source values; an unknown warning system
 * is not evidence that a crossing has no warnings. See schema_nrwn.py and NRWN docs. */
const LABELS: Readonly<Record<string, MessageKey>> = {
  CROSACCES: 'feature.access',
  TCID: 'feature.tcid',
  CROSSINTYP: 'feature.crossingType',
  LEVELCROSS: 'feature.grade',
  WARNINGSYS: 'feature.warnings',
  ROADCLASS: 'feature.roadClass',
  CROSSTYPNM: 'feature.crossedName',
  ROUTENUMBE: 'feature.routeNumber',
  STNENNAME: 'feature.stationName',
  STNTYPE: 'feature.stationType',
  STNUSR1ENA: 'feature.stationUser',
  STRUCTYPE: 'feature.structureType',
  STRUENNAME: 'feature.structureName',
};
export function featureFields(attrs: readonly (readonly [string, string])[]) {
  return attrs.flatMap(([key, value]) => {
    const label = LABELS[key];
    return label && !['', 'None', '-1'].includes(value.trim())
      ? [{ key, label: t(label), value }]
      : [];
  });
}

export type FeatureLocation = {
  key: string;
  subdivision: string;
  mileposts: { value: number; label: string }[];
};
/** Use explicit asset associations only, never the phone's route or nearest-track
 * projection. Published mileage stays attached to its own subdivision. Derived
 * mileage is the pipeline's calibrated value in miles, not a surveyed posting. */
export function featureLocations(asset: NetworkAsset, net: NetworkView): FeatureLocation[] {
  const groups = new Map<string, FeatureLocation>();
  const add = (key: string, name: string, value: number | null, label: string) => {
    let row = groups.get(key);
    if (!row) {
      row = { key, subdivision: name, mileposts: [] };
      groups.set(key, row);
    }
    if (value !== null && !row.mileposts.some((m) => m.value === value && m.label === label))
      row.mileposts.push({ value, label });
  };
  if (asset.posted) {
    const posted = asset.posted;
    const route = [...net.chains, ...net.segments].find(
      (c) => c.subdivisionNid === posted.subdivisionNid,
    );
    add(
      posted.subdivisionNid,
      route?.subdivisionName ?? t('feature.notRecorded'),
      posted.mp,
      t(
        posted.tier === 'posted'
          ? 'feature.publishedMp'
          : posted.tier === 'tc'
            ? 'feature.tcMp'
            : 'feature.unverifiedMp',
      ),
    );
  }
  for (const position of asset.positions) {
    const chain = net.chains.find((c) => c.chainBaseId === position.chainId);
    add(
      chain?.subdivisionNid ?? position.chainId,
      chain?.subdivisionName ?? t('feature.notRecorded'),
      position.derivedMp,
      t('feature.calculatedMp'),
    );
  }
  return [...groups.values()];
}
