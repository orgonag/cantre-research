# Railway company display

Company colours and filters describe the **operator reported by the source**, not
current ownership, current operating rights or a field-verified company boundary.
They do not alter calibration, the strict matcher, the GPS mainline counter or its
route lock. Map filters affect rendered tracks, map-tap results and the visible
asset markers/list; the GPS reference can therefore remain on a hidden company.
The Layers panel explains that distinction and shows the active filter.

## Source names and display aliases

The national snapshot stores marks for chain operators and names for unchained
segments. `app/src/logic/company-names.json` maps source marks and names for display
only. It was checked against `OPERATORMK` and `OPERATOENA` in all eleven registered
NRWN provincial/territorial TRACK packages, acquired with the existing SHA-256
checks in `pipeline/sources`. The source packages are those used for national
snapshot `nrwn-national-c400fd8d+cantre.0.1.1` (2026-10-25). The table is NRWN-derived
information under the Open Government Licence – Canada; original source/licence
details remain in [DATA-LICENSES.md](DATA-LICENSES.md).

Common audited aliases (such as CN / Canadian National and CPR / Canadian Pacific)
share one display identity. Historical names remain historical: this feature does
not rename Canadian Pacific records to CPKC or update acquisitions by inference.
The source's two BNSF spellings and two QNSL spellings are retained as aliases.

Conflicts are deliberately not merged: the source sometimes pairs CN with West
Coast Railway Association or Unknown, and pairs SRCL with Southern Rails Cooperative
and Wheatland Railway. The CN alias accepts Canadian National only; West Coast
Railway Association stays separate. SRCL remains a source-code label while its two
different full names remain separate. Unknown never becomes an alias for a named
operator. Unrecognised future names are shown as supplied.

## Map and labels

- CN and CPR have distinct fixed colours. Other source identities have stable
  swatches. Some colours repeat across the national catalogue, so company names,
  the legend and the filter are always part of identification.
- Several reported operators on one chain produce a separate dashed mainline
  style and retain all operators. Unknown is a distinct grey entry. A source-code
  list does not establish whether operators share the same physical track today.
- Crossing and bridge colours use explicit chain/subdivision associations from
  the installed dataset. They never borrow the nearest track or the phone's route.
  An asset associated with several companies appears under each relevant filter.
  An unassociated asset stays unknown.
- Company names accompany route choices, the GPS HUD, map-tap results and asset
  details. The Layers panel provides the full colour legend and company selector.
- A selected company is saved with the existing display settings. If that identity
  disappears from a later dataset, the map falls back to all companies. No route,
  coordinate, trace or company-selection request is sent to a server.
- The existing offline map makes no new glyph, sprite or logo requests. Company
  labels are HTML text in the interface; the full calculation geometry is unchanged.

The automated tests use synthetic data. Visual review of public NRWN geometry is
not physical-device or independent field validation.
