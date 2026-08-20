'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { XMLParser } = require('fast-xml-parser');
const simplify = require('simplify-js');

const ELEVATION_THRESHOLD_M = 3;
const TARGET_MIN_POINTS = 150;
const TARGET_MAX_POINTS = 250;

// --- Geometry ----------------------------------------------------------

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- GPX parsing -------------------------------------------------------

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept'].includes(name),
});

function collectPoints(ptList, out) {
  for (const pt of ptList) {
    const lat = parseFloat(pt['@_lat']);
    const lon = parseFloat(pt['@_lon']);
    const ele = parseFloat(pt.ele);
    if (!isNaN(lat) && !isNaN(lon) && !isNaN(ele)) {
      out.push({ lat, lon, ele });
    }
  }
}

function parseGpx(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const doc = XML_PARSER.parse(xml);
  const gpx = doc.gpx;

  if (!gpx) throw new Error('Not a valid GPX file (missing <gpx> root element)');

  const raw = [];

  // Prefer <trk> tracks
  if (gpx.trk && gpx.trk.length > 0) {
    for (const trk of gpx.trk) {
      for (const seg of trk.trkseg || []) {
        collectPoints(seg.trkpt || [], raw);
      }
    }
  }

  // Fall back to <rte> routes (some planning tools export these instead)
  if (raw.length === 0 && gpx.rte && gpx.rte.length > 0) {
    for (const rte of gpx.rte) {
      collectPoints(rte.rtept || [], raw);
    }
  }

  if (raw.length < 2) {
    throw new Error('GPX file has fewer than 2 valid elevation points');
  }

  return raw;
}

// --- Profile computation -----------------------------------------------

function computeProfile(points) {
  let cumKm = 0;
  let gain = 0;
  let loss = 0;
  let refEle = points[0].ele;
  let minEle = points[0].ele;
  let maxEle = points[0].ele;

  // enriched[i] = { km: cumulative distance at that point, ele: elevation }
  const enriched = [{ km: 0, ele: points[0].ele }];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];

    cumKm += haversineKm(prev.lat, prev.lon, cur.lat, cur.lon);

    // Hysteresis filter: only record gain/loss when change exceeds threshold
    const diff = cur.ele - refEle;
    if (diff >= ELEVATION_THRESHOLD_M) {
      gain += diff;
      refEle = cur.ele;
    } else if (diff <= -ELEVATION_THRESHOLD_M) {
      loss += Math.abs(diff);
      refEle = cur.ele;
    }

    if (cur.ele < minEle) minEle = cur.ele;
    if (cur.ele > maxEle) maxEle = cur.ele;

    enriched.push({ km: cumKm, ele: cur.ele });
  }

  return { enriched, gain, loss, minEle, maxEle, totalKm: cumKm };
}

// --- Adaptive simplification -------------------------------------------

function adaptiveSimplify(enriched) {
  // simplify-js expects {x, y}
  const pts = enriched.map((p) => ({ x: p.km, y: p.ele }));

  // Already within target range
  if (pts.length >= TARGET_MIN_POINTS && pts.length <= TARGET_MAX_POINTS) {
    return pts;
  }

  // Too few points to simplify further
  if (pts.length < TARGET_MIN_POINTS) {
    return pts;
  }

  // Binary search: higher tolerance -> fewer points
  let lo = 0;
  let hi = 10000;
  let best = pts;
  let bestDistance = Infinity;

  for (let iter = 0; iter < 64; iter++) {
    const mid = (lo + hi) / 2;
    const simplified = simplify(pts, mid, /* highQuality */ true);
    const n = simplified.length;

    // Track result closest to [TARGET_MIN, TARGET_MAX]
    const dist =
      n < TARGET_MIN_POINTS
        ? TARGET_MIN_POINTS - n
        : n > TARGET_MAX_POINTS
          ? n - TARGET_MAX_POINTS
          : 0;

    if (dist < bestDistance) {
      bestDistance = dist;
      best = simplified;
    }

    if (dist === 0) break; // inside target window

    if (n > TARGET_MAX_POINTS) {
      lo = mid; // need more aggressive simplification
    } else {
      hi = mid; // need less aggressive simplification
    }

    if (hi - lo < 1e-9) break;
  }

  return best;
}

// --- Output serialisation ----------------------------------------------

function buildOutput(totalKm, gain, loss, minEle, maxEle, simplified) {
  return {
    distance: Math.round(totalKm * 10) / 10,
    elevationGain: Math.round(gain),
    elevationLoss: Math.round(loss),
    minElevation: Math.round(minEle),
    maxElevation: Math.round(maxEle),
    points: simplified.map((p) => ({
      km: Math.round(p.x * 100) / 100,
      alt: Math.round(p.y),
    })),
  };
}

// --- Supabase ----------------------------------------------------------

async function patchSupabase(raceDayId, profile) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env'
    );
  }

  const endpoint = `${supabaseUrl}/rest/v1/race_days?id=eq.${raceDayId}`;

  const res = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ elevationProfile: profile }),
  });

  return { status: res.status, ok: res.ok };
}

// --- Entry point -------------------------------------------------------

async function main() {
  const [gpxPath, raceDayId] = process.argv.slice(2);

  if (!gpxPath || !raceDayId) {
    console.error('Usage: node index.js <path-to-gpx> <raceDayId>');
    process.exit(1);
  }

  if (!fs.existsSync(gpxPath)) {
    console.error(`File not found: ${gpxPath}`);
    process.exit(1);
  }

  const rawPoints = parseGpx(gpxPath);
  const { enriched, gain, loss, minEle, maxEle, totalKm } =
    computeProfile(rawPoints);
  const simplified = adaptiveSimplify(enriched);
  const profile = buildOutput(totalKm, gain, loss, minEle, maxEle, simplified);

  console.log('--- Elevation profile ---');
  console.log(`Distance:        ${profile.distance} km`);
  console.log(`Elevation gain:  ${profile.elevationGain} m`);
  console.log(`Elevation loss:  ${profile.elevationLoss} m`);
  console.log(`Min elevation:   ${profile.minElevation} m`);
  console.log(`Max elevation:   ${profile.maxElevation} m`);
  console.log(`Points (raw):    ${rawPoints.length}`);
  console.log(`Points (stored): ${profile.points.length}`);

  const { status, ok } = await patchSupabase(raceDayId, profile);
  console.log(`Supabase PATCH:  ${status} ${ok ? 'OK' : 'FAILED'}`);

  if (!ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
