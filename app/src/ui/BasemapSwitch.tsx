import { useState } from 'preact/hooks';
import { t } from '../i18n/index.js';

/**
 * The basemap on/off control (decision D2), shared by the map panel and Settings.
 * Turning it ON first shows the notice: map tiles are fetched from OpenFreeMap for the area
 * shown, which tells that host the area being viewed. The user must accept before anything is
 * requested. Turning it off needs no notice. The state itself lives in the app's settings.
 */
export function BasemapSwitch(props: {
  readonly basemap: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  const { basemap, onChange } = props;
  const [asking, setAsking] = useState(false);

  return (
    <div class="basemap">
      <p class="muted">{t(basemap ? 'map.basemap.on' : 'map.basemap.off')}</p>
      {basemap ? (
        <button
          type="button"
          onClick={() => {
            onChange(false);
          }}
        >
          {t('map.basemap.disable')}
        </button>
      ) : asking ? (
        <div class="notice" role="alertdialog" aria-labelledby="basemap-notice">
          <p id="basemap-notice">{t('map.basemap.notice')}</p>
          <button
            type="button"
            onClick={() => {
              setAsking(false);
              onChange(true);
            }}
          >
            {t('map.basemap.accept')}
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              setAsking(false);
            }}
          >
            {t('map.basemap.cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAsking(true);
          }}
        >
          {t('map.basemap.enable')}
        </button>
      )}
    </div>
  );
}
