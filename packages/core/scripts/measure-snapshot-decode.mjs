/**
 * Reproducible measurement of `networkFromSnapshot`: decode time and JS heap for a real snapshot.
 * This is the evidence behind any decode-time or memory figure quoted for the national snapshot.
 *
 * Run: `node --expose-gc packages/core/scripts/measure-snapshot-decode.mjs <snapshot.bin.gz> [runs] [asset-details.json.gz]`
 * (build first: `npm run build -w @cantre/core`; this file imports `dist/`). Without
 * `--expose-gc` the heap figures are not taken after a forced collection and say so.
 *
 * For each run: gunzip the file (timed separately, Node's zlib), force a GC, record
 * `process.memoryUsage().heapUsed`, time one `networkFromSnapshot` call with
 * `performance.now()`, force a GC again while the view is still referenced, and record
 * `heapUsed` once more. The heap figure is the difference: the live size of the decoded view.
 * With a third argument it also gunzips and `JSON.parse`s the asset-details file and prints the
 * live heap that object adds (what `loadNetwork` holds in `details`).
 * Times are wall-clock milliseconds on this machine and include no network or parse of JSON
 * outside the decoder. Nothing is written to disk.
 */
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { argv, exit, memoryUsage, stderr, stdout, version, versions } from 'node:process';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { networkFromSnapshot } from '../dist/index.js';

const log = (line) => stdout.write(`${line}\n`);
const path = argv[2];
const runs = Number(argv[3] ?? 5);
if (path === undefined || !Number.isInteger(runs) || runs < 1) {
  stderr.write('usage: node --expose-gc measure-snapshot-decode.mjs <snapshot.bin.gz> [runs]\n');
  exit(2);
}

const MiB = 1024 * 1024;
const canCollect = typeof globalThis.gc === 'function';
const collect = () => {
  if (canCollect) {
    globalThis.gc();
    globalThis.gc();
  }
};

const gz = readFileSync(path);
log(
  `machine: ${cpus()[0]?.model ?? 'unknown CPU'} x${cpus().length}, ${(totalmem() / 1024 ** 3).toFixed(1)} GiB RAM, ${platform()} ${arch()}`,
);
log(`node: ${version} (V8 ${versions.v8})`);
log(`file: ${(gz.length / MiB).toFixed(2)} MiB gzip`);
log(`forced GC available: ${canCollect}`);

/** One run in its own function scope, so the view is garbage once it returns. */
function measureOnce(run) {
  const g0 = performance.now();
  const bytes = new Uint8Array(gunzipSync(gz));
  const gunzipMs = performance.now() - g0;
  collect();
  const before = memoryUsage().heapUsed;
  const t0 = performance.now();
  const net = networkFromSnapshot(bytes);
  const decodeMs = performance.now() - t0;
  collect();
  const after = memoryUsage().heapUsed; // the view is still referenced below
  const vertices = net.chains.reduce((n, c) => n + c.pts.length, 0);
  log(
    `run ${run}: gunzip ${gunzipMs.toFixed(0)} ms, decode ${decodeMs.toFixed(0)} ms, ` +
      `heap +${((after - before) / MiB).toFixed(1)} MiB (${(before / MiB).toFixed(1)} -> ${(after / MiB).toFixed(1)} MiB), ` +
      `raw ${(bytes.length / MiB).toFixed(1)} MiB; ${net.chains.length} chains, ${vertices} vertices, ` +
      `${net.segments.length} segments, ${net.intervals.length} intervals, ${net.assets.length} assets, ` +
      `${net.coverage.length} coverage cells`,
  );
  return { decodeMs, heapMiB: (after - before) / MiB };
}

const rows = [];
for (let run = 1; run <= runs; run += 1) {
  rows.push(measureOnce(run));
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
log(
  `median of ${runs}: decode ${median(rows.map((r) => r.decodeMs)).toFixed(0)} ms, ` +
    `heap +${median(rows.map((r) => r.heapMiB)).toFixed(1)} MiB`,
);

const detailsPath = argv[4];
if (detailsPath !== undefined) {
  const raw = gunzipSync(readFileSync(detailsPath));
  collect();
  const before = memoryUsage().heapUsed;
  const details = JSON.parse(raw.toString('utf8'));
  collect();
  const after = memoryUsage().heapUsed;
  log(
    `asset details: ${Object.keys(details).length} assets, ${(raw.length / MiB).toFixed(1)} MiB json, ` +
      `heap +${((after - before) / MiB).toFixed(1)} MiB`,
  );
}
