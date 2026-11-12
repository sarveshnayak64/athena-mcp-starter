# Earthquake Activity Explorer — Athena MCP + Widget

Explore recent earthquakes by **time window, magnitude, depth, and place**, backed by the live
[USGS Earthquake Hazards Program](https://earthquake.usgs.gov/) FDSN feed. The MCP tool returns both
structured data and an embedded interactive Athena widget with a world epicenter map and event list.

No API key is required.

## Quick start

```bash
npm install
npm start          # http://localhost:8787
```

- Interactive preview (no Athena account needed): <http://localhost:8787/demo>
- MCP endpoint (Streamable HTTP): `http://localhost:8787/mcp`
- Health check: `http://localhost:8787/health`
- Raw demo JSON: `http://localhost:8787/api/demo`

Run the end-to-end MCP smoke test while the server is running:

```bash
npm run smoke
```

Inspect the server with the official MCP Inspector:

```bash
npm run inspect
```

## Demo video

A 32-second walkthrough is included at `demo-video/earthquake-explorer-demo.mp4`. It shows the live
widget, depth filtering, place search, a fresh MCP magnitude query, strongest-first sorting, and
selecting an epicenter on the map.

## MCP tool

`explore_earthquakes`

| Input | Type | Default | Notes |
| --- | --- | --- | --- |
| `place` | string | — | Free-text place filter, e.g. `Japan`, `Alaska`, `California` |
| `minMagnitude` | number | `2.5` | 0–10 |
| `maxDepth` | number | — | Maximum depth in km |
| `days` | integer | `7` | 1–30 day window |
| `limit` | integer | `500` | 1–1000 events |

The result contains `items`, `stats`, `query`, `timeRange`, `source`, and `fetchedAt`. The tool is
read-only and uses a 60-second in-memory cache.

## Widget interactions

1. **Search by place** — instantly filters both the map and the list.
2. **Time window** — re-queries USGS through the MCP tool for 24 hours up to 30 days.
3. **Minimum magnitude** — re-queries with a stricter magnitude threshold.
4. **Depth bands** — `All`, shallow `<70 km`, intermediate `70–300 km`, deep `>300 km`.
5. **Sort** — newest, strongest, or deepest.
6. **Select an event** — click a map epicenter or a list row to open its detail card with depth,
   coordinates, felt reports, tsunami flag, review status, and the USGS event link.
7. Widget state (filters + selection) is persisted through `window.openai.setWidgetState`.

## Deploy and connect to Athena

The MCP URL must be public HTTPS. Two simple options:

**Tunnel (fastest)**

```bash
ngrok http 8787
# MCP URL: https://<your-id>.ngrok-free.app/mcp
```

**Container host** (Render, Railway, Fly.io, etc.)

```bash
docker build -t earthquake-explorer .
docker run -p 8787:8787 earthquake-explorer
```

Set `PORT` if the host requires it. The included `render.yaml` can deploy the service on Render;
the public MCP URL is then `https://<service>.onrender.com/mcp`.

Then, in Athena:

1. Create an agent at <https://athenachat.bot>.
2. Add an MCP server using the public `/mcp` URL (no auth header required).
3. Ask something like: *“Show me earthquakes M4.5+ in the last 7 days, then filter to Japan.”*

The agent calls `explore_earthquakes` and the widget is rendered from the
`ui://widget/earthquake-explorer.html` resource. The Athena workspace itself may require an active
plan; the MCP server and `/demo` preview run independently.

## Project layout

| File | Purpose |
| --- | --- |
| `server.js` | MCP server, tool + widget resource, `/demo` preview and JSON API |
| `data.js` | USGS FDSN adapter, normalization, filtering, caching, stats |
| `widget.html` | Interactive map + list widget (inline HTML/CSS/JS) |
| `land-path.txt` | Pre-simplified SVG land outlines |
| `scripts/build-land.mjs` | Regenerates `land-path.txt` from Natural Earth 110m data |
| `scripts/smoke.mjs` | End-to-end MCP smoke test |

## Data and attribution

- Earthquake data: **USGS Earthquake Hazards Program** — public domain.
- Land outlines: **Natural Earth 110m** — public domain.
- Feed endpoint: `https://earthquake.usgs.gov/fdsnws/event/1/query`
