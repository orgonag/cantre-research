import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Vite plugin: writes `third-party-licenses.txt` into the built site, listing every third-party
 * runtime package that ships in it, with name, version, licence and the full licence text copied
 * from node_modules (BSD-3-Clause and MIT both require the notice to travel with the binary).
 *
 * Which packages: the plugin looks at the modules of the emitted JavaScript chunks and takes the
 * package each node_modules file belongs to, then adds those packages' production
 * `dependencies`, recursively. The second step covers code that is in the site but not visible as
 * a chunk module, namely the maplibre-gl worker file (an emitted asset built from the same
 * package and its dependencies). `@types/*` packages are skipped (types only). Dev tools never
 * appear because only `dependencies` are followed, never `devDependencies`. The repository's own
 * packages (`@cantre/*`, resolved to source outside node_modules) are not listed: their licence is
 * the repository's MIT licence, named in the header.
 *
 * A package with no licence file stops the build, so a notice is never silently missing.
 */

interface PackageJson {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  dependencies?: Record<string, string>;
}

/** The licence name as text: the string form, the old `{ type }` object or the `licenses` array. */
export function licenceName(pkg: PackageJson): string {
  if (typeof pkg.license === 'string') return pkg.license;
  if (typeof pkg.license?.type === 'string') return pkg.license.type;
  const types = (pkg.licenses ?? []).flatMap((l) => (typeof l.type === 'string' ? [l.type] : []));
  return types.length > 0 ? types.join(' OR ') : 'see the text below';
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

function readPackage(directory: string): PackageJson {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as PackageJson;
}

/** The directory of the package that owns a file under node_modules, or null. */
function packageDirOf(file: string): string | null {
  const path = file.replace(/\0/g, '').replace(/\?.*$/, '');
  const marker = 'node_modules';
  const parts = path.split(/[\\/]/);
  const at = parts.lastIndexOf(marker);
  if (at < 0 || at + 1 >= parts.length) return null;
  const scoped = parts[at + 1]?.startsWith('@') === true;
  const end = at + (scoped ? 3 : 2);
  const dir = parts.slice(0, end).join('/');
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

/** Find a dependency's directory the way Node does: node_modules in each parent directory. */
function resolveDependency(name: string, from: string): string | null {
  let current = from;
  for (;;) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * The text of the package's licence file(s). A package with none (for example murmurhash-js)
 * may carry its licence under a "License" heading of its README; that section is used and
 * labelled as such. Otherwise null.
 */
function licenceText(directory: string): string | null {
  const names = readdirSync(directory);
  const read = (name: string): string =>
    readFileSync(join(directory, name), 'utf8').replace(/\r\n/g, '\n').trim();
  const files = names.filter((name) => LICENCE_FILE.test(name)).sort();
  if (files.length > 0) return files.map(read).join('\n\n');
  const readme = names.find((name) => /^readme(\.md)?$/i.test(name));
  if (readme === undefined) return null;
  const lines = read(readme).split('\n');
  const start = lines.findIndex((line) => /^#+\s*licen[cs]e/i.test(line));
  if (start < 0) return null;
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith('#'));
  const section = lines.slice(start, length < 0 ? undefined : start + 1 + length);
  return `(licence section of the package README)\n${section.join('\n').trim()}`;
}

/** Build the file text for the given package directories (exported for the tests). */
export function renderLicences(directories: readonly string[]): string {
  const seen = new Map<string, string>();
  const queue = [...directories];
  while (queue.length > 0) {
    const directory = resolve(queue.pop() as string);
    const pkg = readPackage(directory);
    if (pkg.name.startsWith('@types/')) continue;
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.set(id, directory);
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      const found = resolveDependency(dependency, directory);
      if (found === null) throw new Error(`licences: cannot find ${dependency} for ${id}`);
      queue.push(found);
    }
  }
  const blocks = [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, directory]) => {
      const pkg = readPackage(directory);
      const text = licenceText(directory);
      if (text === null) throw new Error(`licences: no licence file in ${id}`);
      return [
        '='.repeat(72),
        `${pkg.name} ${pkg.version}`,
        `Licence: ${licenceName(pkg)}`,
        '='.repeat(72),
        '',
        text,
        '',
      ].join('\n');
    });
  const header = [
    'CANTRE: third-party software notices',
    '',
    'CANTRE itself is MIT-licensed (https://github.com/orgonag/cantre-research). The packages below',
    'are included in this site. Each is listed with its version, licence and licence text, copied',
    'from the package as installed when the site was built. Data licences are separate: see the',
    'About page.',
    '',
  ].join('\n');
  return `${header}\n${blocks.join('\n')}`;
}

/**
 * The Workbox packages whose code is in the emitted service-worker files. Workbox stamps every
 * module it includes with `self["workbox:<name>:<version>"]`, so scanning the emitted `sw.js` and
 * `workbox-*.js` for that marker lists exactly the packages that shipped (workbox-build and the
 * other tools that generated the files are not in the output and so are not found). Each marker
 * maps to the installed package `workbox-<name>`.
 */
export function workboxPackagesIn(sources: readonly string[], from: string): string[] {
  const names = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/workbox:([a-z][a-z-]*):\d/g))
      names.add(match[1] as string);
  }
  return [...names].sort().map((name) => {
    const found = resolveDependency(`workbox-${name}`, from);
    if (found === null) throw new Error(`licences: cannot find workbox-${name}`);
    return found;
  });
}

/** Write the notices file and give its precache entry in sw.js the new content's MD5 revision. */
function finish(outDir: string, fileName: string, chunkPackages: readonly string[]): void {
  const swFiles = readdirSync(outDir).filter((n) => n === 'sw.js' || /^workbox-.*\.js$/.test(n));
  const workbox = workboxPackagesIn(
    swFiles.map((n) => readFileSync(join(outDir, n), 'utf8')),
    outDir,
  );
  const text = renderLicences([...chunkPackages, ...workbox]);
  writeFileSync(join(outDir, fileName), text);
  const swPath = join(outDir, 'sw.js');
  const revision = createHash('md5').update(text).digest('hex');
  const entry = new RegExp(`(url:"${fileName.replace('.', '\\.')}",revision:")[0-9a-f]+(")`);
  const sw = readFileSync(swPath, 'utf8');
  if (!entry.test(sw)) throw new Error(`licences: ${fileName} is not in the precache list`);
  writeFileSync(swPath, sw.replace(entry, `$1${revision}$2`));
}

/**
 * Two steps, because the Workbox files do not exist until vite-plugin-pwa has run (it runs in
 * `closeBundle`): `generateBundle` writes the notices for the chunk packages, so the file exists
 * for the precache list; `closeBundle`, which must come after VitePWA in the plugins array, adds
 * the Workbox packages found in the emitted service-worker files and updates the file's
 * precache revision (Workbox uses the MD5 of the content).
 */
export function licencesPlugin(fileName = 'third-party-licenses.txt'): Plugin {
  let outDir = '';
  let chunkPackages: string[] = [];
  return {
    name: 'cantre-third-party-licences',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler(error) {
        if (error) return;
        finish(outDir, fileName, chunkPackages);
      },
    },
    generateBundle(_options, bundle) {
      const directories = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const id of Object.keys(item.modules)) {
          const directory = packageDirOf(id);
          if (directory !== null) directories.add(directory);
        }
      }
      chunkPackages = [...directories];
      this.emitFile({ type: 'asset', fileName, source: renderLicences(chunkPackages) });
    },
  };
}
