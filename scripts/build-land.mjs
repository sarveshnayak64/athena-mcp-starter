// Builds a compact SVG land path from Natural Earth 110m land polygons.
// Source: https://github.com/nvkelso/natural-earth-vector (public domain)
// Usage: node scripts/build-land.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const src = new URL("../land.geojson", import.meta.url);
const out = new URL("../land-path.txt", import.meta.url);
const REMOTE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";

let contents;
if (existsSync(src)) {
  contents = readFileSync(src, "utf8");
} else {
  console.log("downloading Natural Earth land polygons…");
  const response = await fetch(REMOTE);
  if (!response.ok) {
    console.error(`download failed: ${response.status}`);
    process.exit(1);
  }
  contents = await response.text();
}

const geo = JSON.parse(contents);

function sqSegDist(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplify(points, tolerance) {
  if (points.length <= 4) return points;
  const sqTolerance = tolerance * tolerance;
  const keep = [points[0]];

  const step = (first, last) => {
    let maxSqDist = sqTolerance;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxSqDist) { index = i; maxSqDist = d; }
    }
    if (index > -1) {
      if (index - first > 1) step(first, index);
      keep.push(points[index]);
      if (last - index > 1) step(index, last);
    }
  };

  step(0, points.length - 1);
  keep.push(points[points.length - 1]);
  return keep;
}

function ringArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(area / 2);
}

const rings = [];
for (const feature of geo.features) {
  const g = feature.geometry;
  if (!g) continue;
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 4 || ringArea(ring) < 0.8) continue;
      const simple = simplify(ring, 0.35);
      if (simple.length >= 4) rings.push(simple);
    }
  }
}

const project = ([lon, lat]) => [
  Math.round((lon + 180) * 10) / 10,
  Math.round((90 - lat) * 10) / 10,
];

const parts = [];
const pointPath = (points) => {
  let d = "";
  points.forEach(([x, y], i) => {
    d += i === 0 ? "M" : "L";
    d += `${x} ${y}`;
  });
  return d + "Z";
};

for (const ring of rings) {
  let run = [];
  let previousX = null;
  for (const point of ring) {
    const [x, y] = project(point);
    if (previousX !== null && Math.abs(x - previousX) > 180) {
      if (run.length >= 2) parts.push(pointPath(run));
      run = [];
    }
    run.push([x, y]);
    previousX = x;
  }
  if (run.length >= 2) parts.push(pointPath(run));
}

const path = parts.join("");
writeFileSync(out, path);
console.log(`rings=${rings.length} chars=${path.length}`);
