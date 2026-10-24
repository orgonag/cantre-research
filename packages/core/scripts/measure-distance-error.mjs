/**
 * Reproducible measurement of `distanceM` against GeographicLib on GRS80. This is the evidence
 * behind every distance-error figure quoted in packages/core/README.md, docs/RESEARCH.md and the
 * `distanceM` / `toLocalM` doc comments.
 *
 * Run: `npm run measure:distance -w @cantre/core` (builds first, then runs this file against
 * `dist/`). Dev-only: it imports the dev dependency `geographiclib-geodesic`, never shipped.
 *
 * Reference: GeographicLib Geodesic on GRS80 (a = 6378137 m, f = 1/298.257222101), accurate to
 * about 15 nm (Karney 2013). Error = |distanceM(a, b) - s12(a, b)| with b from the direct
 * problem, so the true length is known independently of `distanceM`.
 *
 * Prints three measurements:
 *  (a) deterministic sweep, d = 2000 m: lat 80 to 83.5 in 0.5 deg steps x azimuth 0 to 359 in 1
 *      deg steps (lon fixed at -100; longitude does not enter the planar formula), maximum in mm
 *      with its lat and azimuth;
 *  (b) N = 50000 seeded random draws: lat 41.5-83.5, lon -141 to -52, azimuth 0-360, d 0-2000 m,
 *      maximum in mm with its inputs; PRNG is mulberry32 with a fixed seed, so it is repeatable;
 *  (c) relative error of a 50 km segment leaving lat 83, lon -100 due east (azimuth 90).
 */
import { stdout } from 'node:process';
import geographiclib from 'geographiclib-geodesic';
import { distanceM } from '../dist/index.js';

const { Geodesic } = geographiclib; // CommonJS package: default import, then destructure
const grs80 = new Geodesic.Geodesic(6378137, 1 / 298.257222101);
const SEED = 20261023;
const DRAWS = 50000;

/** mulberry32 PRNG: returns a function giving uniform doubles in [0, 1). */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Error (metres) of distanceM for the geodesic leaving (lat, lon) at `az` degrees for `d` metres. */
function measure(lat, lon, az, d) {
  const r = grs80.Direct(lat, lon, az, d, Geodesic.LATITUDE | Geodesic.LONGITUDE);
  const a = { lat, lon };
  const b = { lat: r.lat2, lon: r.lon2 };
  const exact = grs80.Inverse(a.lat, a.lon, b.lat, b.lon, Geodesic.DISTANCE).s12;
  return { err: Math.abs(distanceM(a, b) - exact), exact };
}

const mm = (m) => (m * 1000).toFixed(3);
const out = (line) => stdout.write(`${line}\n`);

let sweep = { err: -1, lat: 0, az: 0 };
for (let lat = 80; lat <= 83.5; lat += 0.5) {
  for (let az = 0; az < 360; az += 1) {
    const { err } = measure(lat, -100, az, 2000);
    if (err > sweep.err) {
      sweep = { err, lat, az };
    }
  }
}
out(`(a) sweep max (d = 2000 m): ${mm(sweep.err)} mm at lat ${sweep.lat}, azimuth ${sweep.az}`);

const rand = mulberry32(SEED);
let worst = { err: -1, lat: 0, lon: 0, az: 0, d: 0 };
for (let i = 0; i < DRAWS; i += 1) {
  const lat = 41.5 + rand() * 42;
  const lon = -141 + rand() * 89;
  const az = rand() * 360;
  const d = rand() * 2000;
  const { err } = measure(lat, lon, az, d);
  if (err > worst.err) {
    worst = { err, lat, lon, az, d };
  }
}
out(
  `(b) random max (${DRAWS} draws, seed ${SEED}): ${mm(worst.err)} mm at lat ${worst.lat.toFixed(4)}, ` +
    `lon ${worst.lon.toFixed(4)}, azimuth ${worst.az.toFixed(2)}, d ${worst.d.toFixed(1)} m`,
);

const long = measure(83, -100, 90, 50000);
const rel = long.err / long.exact;
out(`(c) 50 km due east at lat 83: relative error ${rel.toExponential(2)} (${mm(long.err)} mm)`);
