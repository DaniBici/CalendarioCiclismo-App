# gpx-to-profile

Parses a GPX file, computes the elevation profile, and writes it to the
`elevationProfile` column of the matching `race_days` row in Supabase.

## Requirements

- Node.js >= 18 (uses native `fetch`)
- The `elevationProfile jsonb` column must already exist in `race_days`
  (apply `supabase/migrations/024_race_days_elevation_profile.sql` first)

## Setup

```bash
cd tools/gpx-to-profile
npm install
cp .env.example .env   # then fill in the values
```

**.env** (never committed):

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

The service role key is required because the script writes directly to the
table, bypassing RLS. Find it in Supabase dashboard -> Project Settings ->
API -> `service_role` secret.

## Usage

```bash
node index.js RUTA_AL_GPX RACE_DAY_ID
```

`RACE_DAY_ID` es el UUID de la fila de `race_days` (sin angulos ni comillas).

### Example

```bash
node index.js ~/Downloads/stage5.gpx 3f2b1a00-dead-beef-cafe-000000000001
```

Expected output:

```
--- Elevation profile ---
Distance:        156.3 km
Elevation gain:  2840 m
Elevation loss:  2695 m
Min elevation:   42 m
Max elevation:   2115 m
Points (raw):    18432
Points (stored): 213
Supabase PATCH:  200 OK
```

## Output schema

The value written to `elevationProfile` is:

```json
{
  "distance": 156.3,
  "elevationGain": 2840,
  "elevationLoss": 2695,
  "minElevation": 42,
  "maxElevation": 2115,
  "points": [
    { "km": 0.00, "alt": 150 },
    { "km": 1.23, "alt": 178 }
  ]
}
```

| Field            | Type            | Notes                                  |
|------------------|-----------------|----------------------------------------|
| `distance`       | float (1 dec.)  | Total route length in km               |
| `elevationGain`  | int             | Cumulative ascent in m (3 m threshold) |
| `elevationLoss`  | int             | Cumulative descent in m (3 m threshold)|
| `minElevation`   | int             | Lowest point in m                      |
| `maxElevation`   | int             | Highest point in m                     |
| `points`         | array           | 150-250 simplified points              |
| `points[].km`    | float (2 dec.)  | Distance from start in km              |
| `points[].alt`   | int             | Altitude in m                          |

## Notes

- **Elevation threshold**: 3 m hysteresis filter removes GPS/barometer noise
  before accumulating gain/loss.
- **Simplification**: Douglas-Peucker (via `simplify-js`) with adaptive
  tolerance — binary-searched until the point count falls in [150, 250].
- **Multi-track GPX**: all track segments are concatenated in order. Falls
  back to `<rte>` routes if no `<trk>` elements are found.
- **Dry run**: to inspect the profile JSON without uploading, comment out
  the `patchSupabase` call and add `console.log(JSON.stringify(profile))`.
