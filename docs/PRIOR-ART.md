# Prior art: TrackPilot — study, not copying

Inspected [TrackPilot commit d15f712](https://github.com/steidlmichael2000-stack/trackpilot/tree/d15f71265cd720cb6ae8826c6faabd53043026fb)
read-only. No third-party code/tests were executed or implementation/data copied into
RailHUD. The owner does not want TrackPilot data copied; use independently obtained
public sources and independently authored implementation after discussion.

Observed code implements live GPS-to-kilometre calculation. Its primary DB InfraGO
path uses calibrated section endpoints and cumulative polyline distances; OSM fallback
uses kilometre stones and sometimes reconstructed paths or bounded extrapolation.
The formula is closely related to our method; calibrated source data is a material
advantage, not proof of superior projection math. See
[projection and selection](https://github.com/steidlmichael2000-stack/trackpilot/blob/d15f71265cd720cb6ae8826c6faabd53043026fb/infrago.js#L267-L359).

Useful ideas to study: small route bundles, cached cumulative lengths, separate map
and calculation data, visible projection residuals and source-specific labels.
Do not adopt its numeric heuristics, averaging or extrapolation without validation.
Its live previous-route preference is not our strict user lock; it can fall back to
another route. We did not find explicit stale-timestamp rejection in the inspected
GPS path. Read-only observations are not executed acceptance tests.

Published accuracy figures were not independently reproduced. Included round-trip
and same-source crossing checks demonstrate consistency, not surveyed field accuracy.
They do not explain the Sutherland discrepancy. Preserve distinct hypotheses and tests.

Code is labelled GPL-3.0. OSM-derived data is labelled ODbL; InfraGO-derived data is
labelled CC BY 4.0, based on an offering page the importer cites but that this study
did not independently verify. The repository's source months are `2026-09-01` for
OSM network and `2026-05` for InfraGO. Licence assertions, data vintage, object edits
and software version are separate evidence. Studying an algorithm is not permission
to import its code or bundled data; future rights review remains necessary.
