# Try CANTRE

[Open the app](https://orgonag.github.io/cantre-research/). It runs in your browser;
no account or app installation is required. The first visit automatically loads
about 14 MB of public railway data.

## Explore without GPS

1. Open **Menu → Find a location**.
2. Choose the subdivision and enter a milepost in railway miles. Similar names can
   refer to different subdivisions; use the operator and extra context shown.
3. Select **Find**, then **Show on map** if a calibrated result is available.
4. Pan or zoom, then tap a crossing or bridge for that asset's source details.
   Close its panel or tap another asset to continue exploring.

A search result is calculated from the dataset. It is not your GPS location or a
surveyed coordinate. No result means the loaded calibration cannot support that
lookup; CANTRE does not guess outside known ranges. A missing asset is not proof
that no asset exists.

## Use the GPS counter

1. Allow the site's location request if you want location-based readings.
2. Wait for a fresh GPS fix and the rail data to load. The HUD shows the nearest
   mainline with usable calibration, its calculated milepost and distance from it.
3. Tap the route name to inspect nearby alternatives. Selecting a mainline locks
   the reference for the session. **Auto** returns to automatic selection.
4. Pan the map to explore. The compact counter continues to refer to GPS, while the
   map camera moves independently. **Follow me** restores camera following.

The nearest/selected-mainline reading is a geometric projection, including from
positions away from track. It does not identify the track you occupy. GPS accuracy
and distance from track are separate quantities. Missing or stale GPS makes the
current reading unavailable. **Position details** contains the stricter matcher
result and diagnostics. Reloading clears a route lock with a notice.

## Layers, sources and privacy

- **Layers** controls crossings, bridges and **Roads and places**.
- The OpenFreeMap background is on by default. Tile requests reveal the displayed
  area and your internet address to its provider; following GPS can reveal your
  approximate location. Turn off Roads and places to stop those requests. A saved
  off choice is respected.
- GPS calculations happen on your device. CANTRE stores no GPS trace and has no
  analytics or telemetry. The same national rail-data files are downloaded by
  everyone, regardless of location.
- **Menu → Data and sources** shows the installed dataset and available updates.
  Snapshot date means the data build/retrieval date, not the age of every feature.
- An asset panel keeps published, Transport Canada and calculated mileposts
  separate. **Source record** exposes the source fields and record identity;
  missing information stays missing.
- Previously cached app and railway data can support offline use. The basemap is
  not cached by CANTRE, and browser cache availability varies.

## What this release establishes

The app and public-data processing have automated tests. Independent field accuracy,
physical-device endurance and a formal evaluation report remain unverified or
unfinished. Many source features are dated; the current snapshot excludes Nunavut
and Prince Edward Island. French text is a draft awaiting native review.

Use CANTRE for research and exploration. It is not for railway operations, safety
decisions or track access. Calculated mileposts are not surveyed positions.

[Source code](https://github.com/orgonag/cantre-research) ·
[Research record](RESEARCH.md) · [Data and licences](DATA-LICENSES.md)
