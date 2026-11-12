# Public-data recordings

These responses were recorded from the real public endpoints on 11 October 2026 (Pacific/Auckland)
and reduced to the fields Hearth reads. Values were not invented or reshaped.

- `nominatim-wellington.json`: `nominatim.openstreetmap.org/search`, query “12 Cuba Street, Te
  Aro, Wellington, New Zealand”; OpenStreetMap data © contributors, ODbL 1.0.
- `open-meteo-wellington.json`: `api.open-meteo.com/v1/forecast`, Wellington coordinates,
  `Pacific/Auckland`, seven daily rows; Open-Meteo data under CC BY 4.0.
- `data-govt-wellington.json`: `catalogue.data.govt.nz/api/3/action/package_search`, query
  “Wellington City Council rubbish recycling”, three metadata rows. Individual dataset licences
  remain those shown by data.govt.nz.

The deterministic suite replays these bytes through the production parsers. Refresh them only by
calling the same public endpoints, reviewing attribution/licensing, removing unused fields and
updating this note with the recording date.
