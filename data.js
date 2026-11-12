// ===== DATA ADAPTER: live USGS earthquake feed =====
// USGS FDSN event API (public, no key required):
// https://earthquake.usgs.gov/fdsnws/event/1/
const ENDPOINT = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const TTL = 60 * 1000;
const cache = new Map();

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const depthBand = (depth) => {
  if (!Number.isFinite(depth)) return "unknown";
  if (depth < 70) return "shallow";
  if (depth <= 300) return "intermediate";
  return "deep";
};

const magnitudeBand = (mag) => {
  if (!Number.isFinite(mag)) return "light";
  if (mag >= 6) return "major";
  if (mag >= 5) return "strong";
  if (mag >= 4) return "moderate";
  return "light";
};

export async function fetchEarthquakes({
  place = "",
  minMagnitude = 2.5,
  maxDepth = null,
  days = 7,
  limit = 500,
} = {}) {
  const query = {
    place: String(place ?? "").trim(),
    minMagnitude: clamp(minMagnitude, 0, 10, 2.5),
    maxDepth: maxDepth == null || maxDepth === "" ? null : clamp(maxDepth, 0, 1000, null),
    days: clamp(days, 1, 30, 7),
    limit: Math.round(clamp(limit, 1, 1000, 500)),
  };

  const key = JSON.stringify(query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.value;

  const end = new Date();
  const start = new Date(end.getTime() - query.days * 24 * 60 * 60 * 1000);

  // A place search needs a wider net because FDSN has no free-text place filter.
  const requestLimit = query.place
    ? Math.min(5000, Math.max(query.limit * 6, 1000))
    : query.limit;

  const params = new URLSearchParams({
    format: "geojson",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    minmagnitude: String(query.minMagnitude),
    orderby: "time",
    limit: String(requestLimit),
    eventtype: "earthquake",
  });
  if (query.maxDepth != null) params.set("maxdepth", String(query.maxDepth));

  const res = await fetch(`${ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(9000),
    headers: { accept: "application/geo+json, application/json" },
  });

  if (res.status === 204) {
    return emptyResult(query, start, end);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`USGS returned ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }

  const json = await res.json();
  if (!Array.isArray(json.features)) {
    throw new Error("Unexpected USGS response: missing features array");
  }

  let items = json.features
    .map((feature) => {
      const p = feature.properties ?? {};
      const [lon, lat, depth] = feature.geometry?.coordinates ?? [];
      const timeMs = p.time == null ? NaN : Number(p.time);
      const mag = p.mag == null ? null : Number(p.mag);
      const depthKm = depth == null || depth === "" ? NaN : Number(depth);
      const latNum = lat == null || lat === "" ? NaN : Number(lat);
      const lonNum = lon == null || lon === "" ? NaN : Number(lon);
      return {
        id: feature.id,
        place: p.place || "Unknown location",
        mag,
        magType: p.magType || null,
        magnitudeBand: magnitudeBand(mag),
        timeMs,
        time: Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : null,
        depthKm: Number.isFinite(depthKm) ? Math.round(depthKm * 10) / 10 : null,
        depthBand: depthBand(depthKm),
        lat: Number.isFinite(latNum) ? Math.round(latNum * 1000) / 1000 : null,
        lon: Number.isFinite(lonNum) ? Math.round(lonNum * 1000) / 1000 : null,
        url: p.url || null,
        tsunami: p.tsunami === 1,
        alert: p.alert || null,
        felt: Number.isFinite(Number(p.felt)) && p.felt != null ? Number(p.felt) : 0,
        significance: Number.isFinite(Number(p.sig)) && p.sig != null ? Number(p.sig) : 0,
        status: p.status || null,
      };
    })
    .filter((item) => item.lat != null && item.lon != null && Number.isFinite(item.mag) && Number.isFinite(item.timeMs));

  if (query.place) {
    const needle = query.place.toLowerCase();
    items = items.filter((item) => item.place.toLowerCase().includes(needle));
  }

  items.sort((a, b) => b.timeMs - a.timeMs);
  const matched = items.length;
  items = items.slice(0, query.limit);

  const result = {
    items,
    query,
    stats: summarize(items),
    matched,
    returned: items.length,
    timeRange: {
      start: start.toISOString(),
      end: end.toISOString(),
      firstEvent: items.length ? items[items.length - 1].time : null,
      lastEvent: items.length ? items[0].time : null,
    },
    source: "USGS Earthquake Hazards Program",
    sourceUrl: `${ENDPOINT}?${params}`,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(key, { t: Date.now(), value: result });
  return result;
}

function summarize(items) {
  const magnitudes = items.map((item) => item.mag).filter(Number.isFinite);
  const depths = items.map((item) => item.depthKm).filter(Number.isFinite);
  const strongest = items.reduce(
    (best, item) => (best == null || item.mag > best.mag ? item : best),
    null,
  );
  const deepest = items.reduce(
    (best, item) => (best == null || (item.depthKm ?? -1) > (best.depthKm ?? -1) ? item : best),
    null,
  );
  const average = (values) =>
    values.length ? Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10 : null;

  return {
    count: items.length,
    maxMagnitude: magnitudes.length ? Math.max(...magnitudes) : null,
    avgMagnitude: average(magnitudes),
    avgDepthKm: average(depths),
    deepestKm: deepest?.depthKm ?? null,
    strongest: strongest
      ? { id: strongest.id, place: strongest.place, mag: strongest.mag, time: strongest.time }
      : null,
    deepest: deepest
      ? { id: deepest.id, place: deepest.place, depthKm: deepest.depthKm }
      : null,
    depthBands: {
      shallow: items.filter((item) => item.depthBand === "shallow").length,
      intermediate: items.filter((item) => item.depthBand === "intermediate").length,
      deep: items.filter((item) => item.depthBand === "deep").length,
    },
    withTsunamiFlag: items.filter((item) => item.tsunami).length,
  };
}

function emptyResult(query, start, end) {
  return {
    items: [],
    query,
    stats: summarize([]),
    matched: 0,
    returned: 0,
    timeRange: { start: start.toISOString(), end: end.toISOString(), firstEvent: null, lastEvent: null },
    source: "USGS Earthquake Hazards Program",
    sourceUrl: ENDPOINT,
    fetchedAt: new Date().toISOString(),
  };
}
