/**
 * Size gate for the public site (spec section 11, M4 ruling P30). Fails the CI job when a limit
 * is broken, so a size regression is caught before it is deployed.
 *
 * Usage:
 *   node scripts/check-budget.mjs --dir SITE [--tiles TILES_DIR]
 *
 *   --dir SITE         the folder that will be published: the built app (app/dist) with the
 *                      data laid out under SITE/data/. Required.
 *   --tiles TILES_DIR  optional: a folder searched for pipeline tiles (the tiles listed
 *                      by every manifest.json under it, for example <national output>/build).
 *                      Tiles are built and checked but are not deployed, so they are not in
 *                      SITE.
 *
 * The four limits (all in bytes, decimal: 1 kB = 1,000 bytes, 1 MB = 1,000,000 bytes):
 *   1. App shell:  at most 300,000 bytes gzipped. The shell is every file under SITE except
 *                  SITE/data/ and the maplibre-gl library files (its chunk, its CSS and its
 *                  worker, whose names contain "maplibre-gl"), which load only when the map is
 *                  opened (ruling P30). Each file is gzipped on its own at level 9 and the sizes
 *                  are added, which is roughly what a host that compresses on the fly sends. A
 *                  host that does not compress sends more; the figure measures weight and is not
 *                  a promise about any host.
 *   2. Tiles:      each at most 500,000 bytes gzipped, the pipeline's tile budget, using the
 *                  pipeline's own recorded figure (see the comment at the check).
 *   3. One file:   each file under SITE at most 100,000,000 bytes on disk (the GitHub Pages
 *                  per-file limit is 100 MB).
 *   4. The site:   all files under SITE at most 1,000,000,000 bytes on disk (the GitHub Pages
 *                  published-site limit is 1 GB; the decimal figure leaves a small margin
 *                  against a binary 1 GiB).
 *
 * Not a size limit, but required: SITE/third-party-licenses.txt must exist and name maplibre-gl and
 * preact, because their licences require the notice to ship with the site. The app build writes it.
 *
 * A symbolic link anywhere under SITE fails the gate, because the Pages artifact upload rejects
 * links.
 *
 * Exit codes: 0 every limit holds, 1 a limit is broken, 2 bad usage.
 *
 * The limits can be lowered for a test with --max-shell-gzip, --max-tile-gzip, --max-file and
 * --max-site (bytes); a CI run never passes them.
 */
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

const DEFAULT_LIMITS = {
  shellGzip: 300_000,
  tileGzip: 500_000,
  file: 100_000_000,
  site: 1_000_000_000,
};

/** Parse "--name value" pairs; returns null (and prints why) on a misuse. */
function parseArgs(argv) {
  const known = new Set([
    '--dir',
    '--tiles',
    '--max-shell-gzip',
    '--max-tile-gzip',
    '--max-file',
    '--max-site',
  ]);
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!known.has(name) || value === undefined || value.startsWith('--')) {
      process.stderr.write(`check-budget: bad or incomplete option ${String(name)}\n`);
      return null;
    }
    values.set(name, value);
  }
  if (!values.has('--dir')) {
    process.stderr.write('usage: node scripts/check-budget.mjs --dir SITE [--tiles TILES_DIR]\n');
    return null;
  }
  const limit = (flag, fallback) => {
    const text = values.get(flag);
    if (text === undefined) return fallback;
    const n = Number(text);
    return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
  };
  const limits = {
    shellGzip: limit('--max-shell-gzip', DEFAULT_LIMITS.shellGzip),
    tileGzip: limit('--max-tile-gzip', DEFAULT_LIMITS.tileGzip),
    file: limit('--max-file', DEFAULT_LIMITS.file),
    site: limit('--max-site', DEFAULT_LIMITS.site),
  };
  if (Object.values(limits).some(Number.isNaN)) {
    process.stderr.write('check-budget: a limit must be a whole number of bytes\n');
    return null;
  }
  return { dir: values.get('--dir'), tiles: values.get('--tiles') ?? null, limits };
}

/** Every file under root as { path, bytes }; "links" collects symbolic links. */
function walk(root, links) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        links.push(path);
      } else if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        files.push({ path, bytes: lstatSync(path).size });
      }
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Gzip level 9 size of a file, in bytes. */
const gzipBytes = (path) => gzipSync(readFileSync(path), { level: 9 }).length;

/** Path relative to root with forward slashes, for stable output. */
const rel = (root, path) => relative(root, path).split(sep).join('/');

const fmt = (n) => n.toLocaleString('en-US');

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) return 2;
  const { dir, tiles, limits } = args;

  const links = [];
  const files = walk(dir, links);
  if (files.length === 0) {
    process.stderr.write(`check-budget: no files under ${dir}\n`);
    return 2;
  }
  const failures = [];
  for (const link of links) failures.push(`symbolic link in the site: ${rel(dir, link)}`);

  // The licence notices must have been built into the site.
  const noticePath = join(dir, 'third-party-licenses.txt');
  const notice = files.some((f) => f.path === noticePath) ? readFileSync(noticePath, 'utf8') : '';
  if (!notice.includes('maplibre-gl') || !notice.includes('preact')) {
    failures.push('third-party-licenses.txt is missing or does not name maplibre-gl and preact');
  }

  // Limits 3 and 4: raw bytes on disk.
  const siteBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const largest = files.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  for (const f of files) {
    if (f.bytes > limits.file) {
      failures.push(`file over ${fmt(limits.file)} bytes: ${rel(dir, f.path)} is ${fmt(f.bytes)}`);
    }
  }
  if (siteBytes > limits.site) {
    failures.push(`site over ${fmt(limits.site)} bytes: ${fmt(siteBytes)}`);
  }

  // Limit 1: the shell, gzipped file by file.
  const shell = files.filter((f) => {
    const name = rel(dir, f.path);
    return !name.startsWith('data/') && !name.includes('maplibre-gl');
  });
  const maplibre = files.filter((f) => rel(dir, f.path).includes('maplibre-gl'));
  const shellGzip = shell.reduce((sum, f) => sum + gzipBytes(f.path), 0);
  const maplibreGzip = maplibre.reduce((sum, f) => sum + gzipBytes(f.path), 0);
  if (shellGzip > limits.shellGzip) {
    failures.push(`app shell over ${fmt(limits.shellGzip)} bytes gzip: ${fmt(shellGzip)}`);
  }

  // Limit 2: pipeline tiles (not part of the site). The size checked is the pipeline's own
  // "gzipBytes" in each province's manifest.json (gzip level 9, mtime 0, computed by Python's
  // zlib: the tile budget metric). Node's bundled zlib compresses the same bytes to a different,
  // smaller size, so it is not used for tiles. The gate also confirms that every listed tile is
  // on disk with the byte length the manifest records, and that no tile is unlisted.
  let tileCount = 0;
  let largestTile = { name: '(none)', gzip: 0 };
  if (tiles !== null) {
    const found = walk(tiles, []);
    const onDisk = new Map(found.map((f) => [rel(tiles, f.path), f.bytes]));
    const listed = new Set();
    for (const f of found) {
      const name = rel(tiles, f.path);
      if (!name.endsWith('/manifest.json')) continue;
      const folder = name.slice(0, -'manifest.json'.length);
      const manifest = JSON.parse(readFileSync(f.path, 'utf8'));
      if (!Array.isArray(manifest.tiles)) continue;
      for (const tile of manifest.tiles) {
        const tileName = folder + tile.path;
        listed.add(tileName);
        tileCount += 1;
        if (onDisk.get(tileName) !== tile.bytes) {
          failures.push(`tile missing or not the recorded size: ${tileName}`);
        }
        if (tile.gzipBytes > largestTile.gzip) {
          largestTile = { name: tileName, gzip: tile.gzipBytes };
        }
        if (tile.gzipBytes > limits.tileGzip) {
          failures.push(
            `tile over ${fmt(limits.tileGzip)} bytes gzip: ${tileName} is ${fmt(tile.gzipBytes)}`,
          );
        }
      }
    }
    for (const name of onDisk.keys()) {
      if (/(^|\/)tiles\/[^/]+\.json$/.test(name) && !listed.has(name)) {
        failures.push(`tile not listed in a manifest: ${name}`);
      }
    }
    if (tileCount === 0) failures.push(`no tiles found under ${tiles}`);
  }

  const lines = [
    `site: ${dir}`,
    `  files            ${fmt(files.length)}`,
    `  site total       ${fmt(siteBytes)} bytes (limit ${fmt(limits.site)})`,
    `  largest file     ${fmt(largest.bytes)} bytes, ${rel(dir, largest.path)} (limit ${fmt(limits.file)})`,
    `  app shell gzip   ${fmt(shellGzip)} bytes in ${fmt(shell.length)} files (limit ${fmt(limits.shellGzip)})`,
    `  maplibre gzip    ${fmt(maplibreGzip)} bytes in ${fmt(maplibre.length)} files (not in the shell)`,
  ];
  if (tiles !== null) {
    lines.push(
      `  tiles            ${fmt(tileCount)} checked, largest ${fmt(largestTile.gzip)} bytes gzip, ${largestTile.name} (limit ${fmt(limits.tileGzip)})`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`OVER_BUDGET: ${failure}\n`);
    return 1;
  }
  process.stdout.write('check-budget: every limit holds\n');
  return 0;
}

process.exitCode = main();
