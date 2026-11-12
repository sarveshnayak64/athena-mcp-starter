// ===== DATA ADAPTER: the only file to change when the subject is revealed =====
const cache = new Map();
const TTL = 60 * 1000;
const FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";

const band = (m) => (m >= 6 ? "Major (6+)" : m >= 5 ? "Strong (5–6)" : m >= 4 ? "Moderate (4–5)" : "Light (<4)");

export async function fetchItems({ query = "", category = "", limit = 20 }) {
  const key = JSON.stringify([query, category, limit]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  const res = await fetch(FEED, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Upstream error ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.features)) throw new Error("Unexpected response: " + JSON.stringify(json).slice(0, 200));

  let items = json.features.map((f) => ({
    id: f.id,
    title: f.properties.place || "Unknown location",
    subtitle: new Date(f.properties.time).toUTCString(),
    value: f.properties.mag ?? 0,
    category: band(f.properties.mag ?? 0),
    url: f.properties.url,
    lat: f.geometry?.coordinates?.[1],
    lon: f.geometry?.coordinates?.[0],
  }));

  if (query) items = items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase()));
  if (category) items = items.filter((i) => i.category.toLowerCase() === category.toLowerCase());
  items = items.sort((a, b) => b.value - a.value).slice(0, limit);

  const v = { items, source: "USGS Earthquake Hazards Program", fetchedAt: new Date().toISOString() };
  cache.set(key, { t: Date.now(), v });
  return v;
}