import { CoreInputError } from './errors.js';

/**
 * Metres in one mile: 1609.344 m/mi, exact.
 *
 * Source: the international mile, defined as exactly 1609.344 m (1959 international
 * yard-and-pound agreement); CANTRE spec §6 (units). Railway mileposts are in miles, and
 * all internal geometry is in metres, so this is the only conversion factor between them.
 * Limits: this is the international mile, not the US survey mile (about 1609.3472 m).
 */
export const METRES_PER_MILE = 1609.344;

/**
 * Throws `NON_FINITE` unless `value` is a finite number (rejects NaN and +/-Infinity).
 * Shared by the geodesy modules; deliberately not re-exported from the package index.
 */
export function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new CoreInputError('NON_FINITE', `${name} must be a finite number, got ${String(value)}`);
  }
}

/**
 * Converts miles to metres.
 *
 * Formula: metres = miles * 1609.344 (m/mi). Units: input miles, output metres.
 * Source: spec §6 (units); {@link METRES_PER_MILE}.
 * Limits: throws `CoreInputError('NON_FINITE')` for NaN or infinite input. Negative values are
 * allowed, since signed offsets are meaningful. Floating-point rounding is about 1e-16 relative.
 */
export function milesToMetres(mi: number): number {
  assertFinite(mi, 'miles');
  return mi * METRES_PER_MILE;
}

/**
 * Converts metres to miles.
 *
 * Formula: miles = metres / 1609.344 (m/mi). Units: input metres, output miles.
 * Source: spec §6 (units); {@link METRES_PER_MILE}.
 * Limits: throws `CoreInputError('NON_FINITE')` for NaN or infinite input. Negative values are
 * allowed. Round trip with {@link milesToMetres} is exact to floating-point rounding only.
 */
export function metresToMiles(m: number): number {
  assertFinite(m, 'metres');
  return m / METRES_PER_MILE;
}

/**
 * Converts miles to kilometres.
 *
 * Formula: kilometres = miles * 1609.344 / 1000 (km/mi), i.e. 1.609344 km per mile.
 * Units: input miles, output kilometres.
 * Source: spec §6 (units); {@link METRES_PER_MILE}.
 * Limits: throws `CoreInputError('NON_FINITE')` for NaN or infinite input. Negative values allowed.
 */
export function milesToKilometres(mi: number): number {
  assertFinite(mi, 'miles');
  return (mi * METRES_PER_MILE) / 1000;
}
