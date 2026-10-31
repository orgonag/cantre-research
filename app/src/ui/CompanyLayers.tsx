import type { Company } from '../logic/companies.js';
import { companyLabel, SHARED_COLOURS } from '../logic/companies.js';
import { t } from '../i18n/index.js';
import { CompanyLabel } from './CompanyLabel.js';

export function CompanyLayers(props: {
  companies: readonly Company[];
  selected: string;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset class="company-layers">
      <legend>{t('company.heading')}</legend>
      <label for="company-filter">{t('company.filter')}</label>
      <select
        id="company-filter"
        value={props.selected}
        onChange={(e) => {
          props.onChange(e.currentTarget.value);
        }}
      >
        <option value="">{t('company.all')}</option>
        {props.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {companyLabel(c)}
          </option>
        ))}
      </select>
      <p class="muted">{t('company.filterHelp')}</p>
      <details class="company-legend" open={props.selected !== ''}>
        <summary>{t('company.legend')}</summary>
        <ul class="plain">
          {props.companies
            .filter((c) => !props.selected || c.id === props.selected)
            .map((c) => (
              <li key={c.id}>
                <CompanyLabel company={c} />
              </li>
            ))}
        </ul>
        <p>
          <span
            class="company-swatch company-swatch--shared"
            aria-hidden="true"
            style={{
              '--company-light': SHARED_COLOURS.light,
              '--company-dark': SHARED_COLOURS.dark,
            }}
          />{' '}
          {t('company.multiple')}
        </p>
        <p class="muted">{t('company.colourNote')}</p>
      </details>
      <p class="muted">{t('company.sourceNote')}</p>
    </fieldset>
  );
}
