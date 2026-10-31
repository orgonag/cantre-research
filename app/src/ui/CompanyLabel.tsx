import type { Company } from '../logic/companies.js';
import { companyLabel } from '../logic/companies.js';

/** Text always accompanies the swatch, including for colour-blind and screen-reader users. */
export function CompanyLabel({
  company,
  compact = false,
}: {
  company: Company;
  compact?: boolean;
}) {
  return (
    <span class="company-label">
      <span
        aria-hidden="true"
        class="company-swatch"
        style={{ '--company-light': company.light, '--company-dark': company.dark }}
      />
      <span title={companyLabel(company)}>
        {compact && !company.id.startsWith('name:') && company.id !== 'unknown'
          ? company.id
          : companyLabel(company)}
      </span>
    </span>
  );
}
