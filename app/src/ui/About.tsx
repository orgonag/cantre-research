import type { InstalledSnapshot } from '@cantre/data-client';
import { catalogueMeta, t } from '../i18n/index.js';

/** The project's source code (public repository). */
export const REPO_URL = 'https://github.com/orgonag/cantre-research';

/**
 * About: how the milepost is calculated (in plain words, with no accuracy figures), the data
 * sources and their licences, the installed snapshot's date and each province's NRWN package
 * version (from the manifest, so it says exactly what is installed), the note that the French
 * text is a draft (D3), the full research disclaimer (D7) and the link to the code.
 */
export function About(props: { readonly installed: InstalledSnapshot | null }) {
  const { installed } = props;
  const provinces = Object.entries(installed?.packageVersions ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return (
    <section class="about" aria-labelledby="screen-heading">
      <h3 id="screen-heading" tabIndex={-1}>
        {t('about.heading')}
      </h3>

      <h3>{t('about.methods.heading')}</h3>
      <p>{t('about.methods.body')}</p>

      <h3>{t('about.sources.heading')}</h3>
      <ul>
        <li>{t('about.sources.nrwn')}</li>
        <li>{t('about.sources.tc')}</li>
        <li>{t('about.sources.basemap')}</li>
      </ul>
      <p>{t('map.attribution.ogl')}</p>
      <p>{t('map.attribution.osm')}</p>

      <h3>{t('about.snapshot.heading')}</h3>
      {installed === null ? (
        <p>{t('about.snapshot.none')}</p>
      ) : (
        <>
          <p>{t('about.snapshot.date', { date: installed.snapshotDate })}</p>
          {provinces.length > 0 && (
            <>
              <h4>{t('about.snapshot.packages')}</h4>
              <ul class="plain provinces">
                {provinces.map(([code, version]) => (
                  <li key={code}>
                    <strong>{code.toUpperCase()}</strong> {version}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {catalogueMeta('fr').reviewStatus === 'needs native review' && (
        <>
          <h3>{t('about.french.heading')}</h3>
          <p>{t('about.french')}</p>
        </>
      )}

      <h3>{t('about.disclaimer.heading')}</h3>
      <p>{t('disclaimer.full')}</p>

      <h3>{t('about.code.heading')}</h3>
      <p>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">
          {t('about.code.link')}
        </a>
      </p>
      <p>
        <a href="third-party-licenses.txt" target="_blank" rel="noopener noreferrer">
          {t('about.thirdParty.link')}
        </a>
      </p>
      <p class="muted">{t('about.licence')}</p>
    </section>
  );
}
