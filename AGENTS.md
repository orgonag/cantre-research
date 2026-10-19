# Instructions for implementation agents

Read README.md and all docs before proposing a change. This repository currently
contains research documentation only. Do not describe planned features as built.

## Scope and rights

- Work in this repository; preserve the archived source application unchanged.
- Independently author implementation. Do not copy employer/private source,
  coordinates, fixtures, database records, photos or credentials without established
  rights and explicit authorization. Never commit downloaded private reference data.
- Keep visibility private. Public release, deployment, external telemetry and national
  bulk downloads require separate authorization. Do not add an open-source licence
  that implies rights clearance over unknown materials.
- Public source ingestion must preserve publisher, licence, source URL, retrieval
  timestamp, version evidence, CRS, checksums and transformation recipe.
- Do not record or upload phone location by default. Explicit user opt-in is required
  for any retained/exported trace; show what leaves the device.

## Implementation discipline

The approved working method is collaborative learning, not autonomous delivery of
an entire app. Teach the owner the math and coding and build together line by line.
Read docs/LEARNING.md. Before each substantive implementation step, explain its
purpose, prerequisites, formula, units and proposed small change; discuss it with
the owner and wait for direction to continue. Do not interpret the staged plan as
blanket authorization to implement all stages. After an agreed small step, explain
each line and calculation, inspect its result together and pause before the next.

The first proposed coding topic is a tiny independent projection function with a
synthetic example, not a scaffolded app. Use a branch and reviewable PR. Recheck
current state, instructions and dependency documentation before agreed coding.
Documentation maintenance and expressly requested checks may proceed within their
authorized scope. Never copy the old app or autonomously build the full project.

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
