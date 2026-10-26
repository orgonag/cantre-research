import { t } from '../i18n/index.js';
import type { Settings as SettingsValue } from '../logic/settings.js';
import { BasemapSwitch } from './BasemapSwitch.js';

/**
 * Settings: distance units, language and the basemap (with its notice, D2). The component holds
 * no state of its own. Every change goes to the app, which merges it into the latest settings
 * and saves the whole object. A language change shows at once because the app re-renders every
 * screen with the new language. Nothing but these three values is stored (spec section 9).
 */
export function Settings(props: {
  readonly settings: SettingsValue;
  readonly onChange: (change: Partial<SettingsValue>) => void;
}) {
  const { settings, onChange } = props;
  return (
    <section class="settings" aria-labelledby="screen-heading">
      <h3 id="screen-heading" tabIndex={-1}>
        {t('settings.heading')}
      </h3>

      <fieldset>
        <legend>{t('settings.units')}</legend>
        {(['mi', 'km'] as const).map((units) => (
          <label key={units} class="choice">
            <input
              type="radio"
              name="units"
              value={units}
              checked={settings.units === units}
              onChange={() => {
                onChange({ units });
              }}
            />{' '}
            {t(`settings.unit.${units}`)}
          </label>
        ))}
        <p class="muted">{t('settings.unitsNote')}</p>
      </fieldset>

      <fieldset>
        <legend>{t('settings.language')}</legend>
        {(['en', 'fr'] as const).map((lang) => (
          <label key={lang} class="choice">
            <input
              type="radio"
              name="lang"
              value={lang}
              checked={settings.lang === lang}
              onChange={() => {
                onChange({ lang });
              }}
            />{' '}
            <span lang={lang}>{t(`settings.lang.${lang}`)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>{t('settings.basemap')}</legend>
        <BasemapSwitch
          basemap={settings.basemap}
          onChange={(basemap) => {
            onChange({ basemap });
          }}
        />
      </fieldset>

      <p class="muted">{t('settings.storage')}</p>
    </section>
  );
}
