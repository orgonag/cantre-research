# Core RailHUD browser build

Initial core release deployed from PR #14 on 2026-10-26.
Phone follow-up changes are described below.
The owner approved a full-screen map with one dark floating HUD and then authorized
implementation. This supersedes the M4 download-first and optional-map presentation.
Matching semantics, public data sources and production hosting remain unchanged.
The release also includes the separately authorized pipeline 0.1.1 ID-order repair;
its data impact and verification are recorded in RESEARCH.md.

## Interaction contract

- Opening the page starts one browser location watch immediately while the verified
  national dataset loads automatically. No installation or manual file download is needed.
- The map stays mounted. The HUD shows subdivision, calculated milepost (three display
  decimals, not a precision claim), supported direction, device speed and GPS accuracy.
  Unknown values are dashes. MP remains in railway miles even when display distances
  and speed use kilometres.
- Tap the subdivision to choose from nearby mainlines, with distance and calculated
  mileage (or unavailable) shown for each. Auto chooses the nearest mainline whose
  closest projection has usable calibration. Spurs, sidings, yards and rapid transit
  do not replace it. A manual selection stays locked even without mileage; Auto is
  the explicit return to automatic selection. Stale GPS clears the current reading.
  The original strict match and its conflicts remain in Position details.
- Initial mode follows GPS. Dragging pauses follow; a new fix never resumes it. Recenter
  restores follow without resetting the user's zoom. Search fits its result and pauses
  follow. The main HUD always refers to GPS, not a map tap or search result.
- Layers offers only asset kinds present in the dataset, initially crossings and bridges,
  and remembers changes in the existing settings key. Markers and the accessible visible-assets list share
  the nearest 100 enabled items in the viewport, ranked around the fix while following
  or around the map centre while exploring. No subdivision filter hides nearby assets.
- Menu, route, search, layers, source data and settings use one native modal sheet with
  Escape, focus containment and focus restoration. Sheets do not restart GPS or the map.
- Screen-awake uses the browser Wake Lock API. Its indicator represents an actually held
  lock. Rejection leaves it off; release updates it; visible resume reacquires only when
  requested. Unsupported browsers have a disabled control.
- Roads and places default on, per the owner's phone follow-up request; an explicitly saved off choice is respected. The OpenFreeMap background keeps its fallback and disclosure. Public tiles are not cached
  for bulk offline use. Research notice and source attribution remain available.
- Notes, photographs, entries, archive, accounts, telemetry and a new backend are excluded.

## Data and hosting

Production continues to use the existing GitHub Pages app and `data/manifest.json` with
versioned snapshot and asset-detail files. A local preview is not production hosting.
The current public dataset is approximately 14 MB compressed. Cache Storage is optional:
verified bytes are decoded once at startup and usable online even if storage is denied
or full. Startup tries an older intact cached build before fetching when a newer cached
build is damaged. All integrity, format and dataset-identity checks still apply.

The active dataset is pinned to its session. A user explicitly applies updates in Data
and sources; a version change clears the route lock with a notice. No coordinates are
included in data URLs. Settings and the existing boolean lock flag remain the only
personal preferences stored. No location trace is retained.

## Verification and limits

See the latest entry in [RESEARCH.md](RESEARCH.md) for executed checks and release gates.
Browser fixtures are independently authored synthetic railway data and mocked GPS.
`railhud.spec.ts` covers automatic startup, cache denial, persistent GPS/map lifecycle,
route selection in a normal match, stale clearing, following, wake release/rejection,
position-dot rendering, narrow/landscape layouts and sheet focus.

The WebKit 2370 mock in the installed Playwright 1.64.0 supplies its GPS timestamp in
microseconds although the protocol receives epoch milliseconds. The test-only adapter
normalizes that provider output. Production continues to reject implausibly future fixes.
These WebKit tests are not physical iPhone or field-GPS validation.

A local national-data sample (Node 26 on a Mac, 25 fixes, no network transfer included)
measured 1,252 chains and 64,061 assets: verified load/decode about 1.38 s, display geometry
about 114 ms, median matching 7.0 ms, maximum matching 24.9 ms, maximum visible-asset
selection 14.7 ms. Dataset: `nrwn-national-c400fd8d+cantre.0.1.0`.
This is a desktop diagnostic, not a phone performance guarantee. Actual iPhone Safari,
Android Chrome, enlarged system text, sustained 15-minute movement/pan testing and field
accuracy remain unverified. No matcher/index rewrite was justified by this sample.

## Maintenance gotchas

- `MapLibre.isStyleLoaded()` can be false during normal GeoJSON source updates. Do not
  gate GPS marker pushes on it: a fresh fix can otherwise disappear until another style
  reload. Push to sources that exist; `style.load` restores the latest complete state.
- Serve `.gz` data as opaque bytes, without `Content-Encoding: gzip`. Vite preview can
  transparently decompress them and make integrity checks fail. `app/e2e/server.mjs`
  preserves bytes; `CANTRE_DATA_ROOT` optionally selects a locally prepared public dataset.
- The app is static. There is no application-server build. Build the core package and
  frontend; deployment remains an explicit separate action through the existing workflow.
- Preserve the previous deployment/data artifacts for rollback. No production data or
  deployed site was changed by this branch.

## Phone follow-up contract

The capped card is horizontally centered at all viewport widths. The main HUD now
searches for the nearest **mainline with usable mileage**, including off-network fixes.
It shows NEAREST MAINLINE MILEPOST, distance from mainline and Auto mode. A selected
route shows SELECTED MAINLINE MILEPOST and a visible lock. These are geometric
projections, not on-track claims. The GPS map dot stays at the actual fix.

Only Main-class geometry participates. Search starts at 10 km and expands until a
usable mainline is found or the loaded geometry is exhausted. The chooser lists the
nearest eight mainline chains plus the current selection if farther away. It keeps
uncalibrated alternatives visible. Each chain uses its closest projection, never a
farther calibrated pass substituted for an uncalibrated nearest pass. A lock restricts
selection without hiding alternatives; missing locked geometry produces no reading.
Unverified reference points are labelled. If no mainline has usable mileage, show
the nearest mainline with mileage unavailable. Never bridge gaps or extrapolate.

The original strict match result remains available in Position details. Its direction
arrow is used only for the same selected chain. Stale or missing GPS clears the
mainline reading and choices. Roads/places start on for new visits; a saved off
choice remains off. Tests use synthetic coordinates; physical-phone validation
remains separate from browser geolocation emulation.

Tapping a map feature opens only that feature, with its name or type as the sheet
title and its source attributes expanded. Resolve the selection against the loaded
network so viewport/GPS updates cannot replace it with another visible feature.
Menu → Visible assets still opens the full viewport list and clears the selection.

The feature summary uses readable labels for access, warning system, crossing level,
road class, TC ID and other published attributes. Subdivision names come from explicit
asset associations. Published, TC, unverified and calculated mileage retain separate
labels and route associations; unavailable information says Not recorded. Source record
keeps the original field names, record ID and dataset version for inspection.
Crossing label semantics were checked against the public
[NRWN-adapted Ontario crossing dictionary](https://www.publicdocs.mnr.gov.on.ca/mirb/ORWN%20Crossing%20-%20Data%20Description.pdf).
Source values remain unchanged; Unknown is never converted to None.
