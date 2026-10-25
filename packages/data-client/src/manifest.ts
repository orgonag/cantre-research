import { DataClientError } from './errors.js';

/**
 * The part of a national `cantre.manifest/1` (pipeline/schema/manifest.schema.json) the app needs.
 * Other keys (config, sources, per-province totals) are ignored here.
 */

/** A published file: `sha256` is of the gzip bytes exactly as served (hash before gunzip). */
export type FileRef = {
  /** Path relative to the manifest's own URL. */
  readonly path: string;
  /** 64 lower-case hex characters. */
  readonly sha256: string;
  /** Size after gunzip, bytes. */
  readonly bytes: number;
  /** Size of the file at `path` as served, bytes. */
  readonly gzipBytes: number;
};

export type Manifest = {
  readonly schema: 'cantre.manifest/1';
  /** The one dataset version of this build; the snapshot's own version must equal it. */
  readonly datasetVersion: string;
  /** The OGL-Canada attribution sentence to show. */
  readonly attribution: string;
  /** `YYYY-MM-DD`, the vintage label shown to the user. */
  readonly snapshotDate: string;
  /**
   * The snapshot's byte-layout version (pipeline/schema/snapshot.md). A manifest written before
   * the field existed reads as 1, the only layout there was then.
   */
  readonly snapshotFormat: number;
  readonly snapshot: FileRef;
  readonly assetDetails: FileRef;
  /** NRWN package version of each province, by lower-case province code (may be empty). */
  readonly packageVersions: Readonly<Record<string, string>>;
};

function invalid(problem: string): never {
  throw new DataClientError('MANIFEST_INVALID', `manifest: ${problem}`);
}

function obj(x: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    return invalid(`${what} is not an object`);
  }
  return x as Readonly<Record<string, unknown>>;
}

function text(o: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') {
    return invalid(`${what}.${key} is not a non-empty string`);
  }
  return v;
}

function size(o: Readonly<Record<string, unknown>>, key: string, what: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    return invalid(`${what}.${key} is not a non-negative integer`);
  }
  return v;
}

/** A relative file path of plain segments (no scheme, no query, no `..`, no leading slash). */
const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function fileRef(raw: unknown, what: string): FileRef {
  const o = obj(raw, what);
  const path = text(o, 'path', what);
  if (!SAFE_PATH.test(path) || path.split('/').some((seg) => seg === '.' || seg === '..')) {
    invalid(`${what}.path is not a plain relative file path`);
  }
  const sha256 = text(o, 'sha256', what);
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    invalid(`${what}.sha256 is not 64 lower-case hex characters`);
  }
  const gzipBytes = size(o, 'gzipBytes', what);
  if (gzipBytes === 0) {
    invalid(`${what}.gzipBytes is 0`);
  }
  return { path, sha256, bytes: size(o, 'bytes', what), gzipBytes };
}

/**
 * Validates a parsed manifest. It must be a national manifest: `schema` is `cantre.manifest/1`
 * and `snapshot`, `assetDetails` and `snapshotDate` are present (a manifest must not name files
 * the site does not serve). The file paths must be plain relative paths, so a hostile manifest
 * cannot point the client at another host. `snapshotFormat` must be a positive integer when
 * present; whether this app supports it is checked by `downloadSnapshot`, so an unsupported
 * format is its own error (`UNSUPPORTED_FORMAT`), not a broken manifest. Throws
 * `DataClientError('MANIFEST_INVALID')`.
 */
export function parseManifest(json: unknown): Manifest {
  const o = obj(json, 'manifest');
  if (o.schema !== 'cantre.manifest/1') {
    invalid("schema is not 'cantre.manifest/1'");
  }
  const snapshotDate = text(o, 'snapshotDate', 'manifest');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    invalid('snapshotDate is not YYYY-MM-DD');
  }
  // Absent means a manifest from before the field existed; every such build is layout 1.
  const snapshotFormat = o.snapshotFormat === undefined ? 1 : o.snapshotFormat;
  if (
    typeof snapshotFormat !== 'number' ||
    !Number.isSafeInteger(snapshotFormat) ||
    snapshotFormat < 1
  ) {
    return invalid('snapshotFormat is not a positive integer');
  }
  const packageVersions: Record<string, string> = {};
  if (o.provinces !== undefined) {
    for (const [code, p] of Object.entries(obj(o.provinces, 'provinces'))) {
      packageVersions[code] = text(
        obj(p, `provinces.${code}`),
        'packageVersion',
        `provinces.${code}`,
      );
    }
  }
  return {
    schema: 'cantre.manifest/1',
    datasetVersion: text(o, 'datasetVersion', 'manifest'),
    attribution: text(o, 'attribution', 'manifest'),
    snapshotDate,
    snapshotFormat,
    snapshot: fileRef(o.snapshot, 'snapshot'),
    assetDetails: fileRef(o.assetDetails, 'assetDetails'),
    packageVersions,
  };
}
