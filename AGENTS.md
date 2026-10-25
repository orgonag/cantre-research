# Instructions for implementation agents

Read README.md and all docs before proposing a change. This repository holds the
research docs, the calculation core (M1) and the data pipeline (M2). Do not describe
planned features as built.

## Scope and rights

- Work in this repository; preserve the archived source application unchanged.
- Independently author implementation. Do not copy employer/private source,
  coordinates, fixtures, database records, photos or credentials without established
  rights and explicit authorization. Never commit downloaded private reference data.
- The repository is public: the owner made it public on 2026-10-25, accepting that
  its full history, commit emails and the private-reference summary are published.
  Treat everything committed as public. Enabling Pages, deploying and external
  telemetry each still need the owner's explicit go-ahead. The owner chose MIT for independently authored code (2026-10-23); data
  stays under each source's own licence (NRWN: OGL-Canada). Never imply rights over
  material we did not author. Downloading every public NRWN province package for the
  pipeline is authorized by the v1 spec, as is the Transport Canada Grade Crossings
  Inventory CSV (owner adopted it 2026-10-24). RAC and any other source still need a
  go-ahead.
- Public source ingestion must preserve publisher, licence, source URL, retrieval
  timestamp, version evidence, CRS, checksums and transformation recipe.
- Do not record or upload phone location by default. Explicit user opt-in is required
  for any retained/exported trace; show what leaves the device.

## Implementation discipline

On 2026-10-23 the owner replaced the line-by-line learning method: build CANTRE to
research grade, "with all the bells and whistles", comment the math and code
thoroughly, and get it ready for release. The governing design is
[the v1 spec](docs/superpowers/specs/2026-10-23-cantre-v1-design.md), and its
implementation plan sets the order of work.

Work milestone by milestone, each on a branch with a reviewable PR that the owner
approves before the next. Comment every formula with its units, source and limits,
so the owner and reviewers can follow the method from the code. Recheck current
dependency versions and licences before adding any. Never copy the old app.
[LEARNING.md](docs/LEARNING.md) remains the record of the earlier lessons.

Keep units explicit. Separate cross-track residual, along-track distance, calculated
milepost, ambiguity and survey accuracy. A small residual is not a confidence interval.
Do not fabricate missing values, silently bridge topology gaps, interpolate across
milepost discontinuities or extrapolate beyond qualified anchors.

Every numerical claim needs a dataset version, metric definition and evidence.
The 57.91 m mean / 145.56 m maximum are diagnostic disagreements, not truth. Do not
claim 1% compliance until its denominator and near-zero rule are agreed.

Run tests appropriate to each change, record commands/results and disclose untested
behavior. PR descriptions must distinguish implemented, tested and deferred work.
Do not publish private paths, raw per-location results or original source snippets
in issues, PRs or documentation. Research use conveys no access authority or safety
guarantee. LRT is optional and must not block the conventional-rail pilot.

Owner priority: diamonds/perpendicular crossings and nearby different Class I routes.
Use validated evidence for automatic choice, explicit user selection for ambiguity,
and a visible route/subdivision lock with no silent switching. Stale/conflicting
fixes must not produce a current confident match. Selection does not improve GPS
precision. Read docs/PROJECTION.md and the selection contract before implementing.

Preserve full calculation geometry separately from simplified display tiles. Do not
copy TrackPilot code or data; prior-art study is not an import authorization. Treat
GPL code, OSM ODbL data and each upstream source licence separately. Cloudflare
Pages/R2 are hosting proposals only, not deployment permission. Keep raw snapshots,
licences, hashes and acquisition/feature dates distinct. No national download is
claimed. Preserve the original calculation locally as a comparison baseline, never
as ground truth or material cleared for redistribution.
