import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { fetchEarthquakes } from "./data.js";

const WIDGET_URI = "ui://widget/earthquake-explorer.html";
const TOOL_NAME = "explore_earthquakes";

const widgetFile = new URL("./widget.html", import.meta.url);
const landFile = new URL("./land-path.txt", import.meta.url);
const landPath = existsSync(landFile) ? readFileSync(landFile, "utf8").trim() : "";

function widgetHtml() {
  return readFileSync(widgetFile, "utf8").replace("__LAND_PATH__", landPath);
}

const reply = (text, data) => ({
  content: [{ type: "text", text }],
  structuredContent: data,
});

function createMcp() {
  const server = new McpServer({ name: "athena-earthquake-explorer", version: "1.0.0" });

  server.registerResource("earthquake-explorer-widget", WIDGET_URI, {}, async () => ({
    contents: [{
      uri: WIDGET_URI,
      mimeType: "text/html+skybridge",
      text: widgetHtml(),
      _meta: {
        "openai/widgetPrefersBorder": true,
        "openai/widgetDescription":
          "Interactive world map and event list of recent earthquakes from live USGS data. Filter by time window, minimum magnitude, depth band and place; select an epicenter for details.",
        "openai/widgetCSP": {
          connect_domains: [],
          resource_domains: [],
        },
      },
    }],
  }));

  server.registerTool(
    TOOL_NAME,
    {
      title: "Explore recent earthquakes",
      description:
        "Use this when the user asks about recent earthquakes, seismic activity, the strongest or deepest quakes, or activity in a specific place. Reads the live USGS Earthquake Hazards feed and returns an interactive map + list widget. Supports a time window (1-30 days), minimum magnitude, maximum depth, a free-text place search, and a result limit.",
      inputSchema: {
        place: z
          .string()
          .optional()
          .describe("Free-text place filter, e.g. 'California', 'Japan', 'Alaska'."),
        minMagnitude: z
          .coerce.number()
          .min(0)
          .max(10)
          .optional()
          .describe("Minimum magnitude, default 2.5."),
        maxDepth: z
          .coerce.number()
          .min(0)
          .max(1000)
          .optional()
          .describe("Maximum depth in kilometres. Omit for all depths."),
        days: z
          .coerce.number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe("Time window in days, default 7."),
        limit: z
          .coerce.number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Maximum number of events to return, default 500."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Reading the live USGS earthquake feed",
        "openai/toolInvocation/invoked": "Earthquake map ready",
      },
    },
    async (args) => {
      try {
        const data = await fetchEarthquakes(args);
        const window = `${data.query.days} day${data.query.days === 1 ? "" : "s"}`;
        const summary = data.items.length
          ? `Found ${data.items.length} earthquakes in the last ${window}` +
            ` (M${data.query.minMagnitude}+), strongest M${data.stats.maxMagnitude}.`
          : `No earthquakes matched the query in the last ${window}.`;
        return reply(summary, data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply(`Could not load USGS earthquake data: ${message}`, {
          items: [],
          error: message,
          query: args,
          source: "USGS Earthquake Hazards Program",
          fetchedAt: new Date().toISOString(),
        });
      }
    },
  );

  return server;
}

function demoPayload(url) {
  return fetchEarthquakes({
    place: url.searchParams.get("place") ?? "",
    minMagnitude: url.searchParams.get("minMagnitude") ?? 2.5,
    days: url.searchParams.get("days") ?? 7,
    limit: url.searchParams.get("limit") ?? 500,
    maxDepth: url.searchParams.get("maxDepth") ?? null,
  });
}

const landing = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Athena Earthquake Explorer MCP</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;line-height:1.6;color:#1b1b1f}
code{background:#f1eee9;padding:2px 6px;border-radius:6px}
a{color:#c2410c}
</style></head><body>
<h1>Earthquake Activity Explorer</h1>
<p>Live USGS earthquake data exposed over the Model Context Protocol, with an embedded interactive map widget.</p>
<ul>
  <li>MCP endpoint: <a href="/mcp"><code>/mcp</code></a> (Streamable HTTP)</li>
  <li>Widget preview: <a href="/demo"><code>/demo</code></a></li>
  <li>Demo JSON: <a href="/api/demo"><code>/api/demo</code></a></li>
  <li>Health: <a href="/health"><code>/health</code></a></li>
</ul>
<p>Tool: <code>${TOOL_NAME}</code> &middot; Source: USGS Earthquake Hazards Program</p>
</body></html>`;

const port = Number(process.env.PORT ?? 8787);
const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    }).end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(landing);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      ok: true,
      service: "athena-earthquake-explorer",
      tool: TOOL_NAME,
      source: "USGS Earthquake Hazards Program",
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/demo") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(widgetHtml());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/demo") {
    try {
      const data = await demoPayload(url);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (url.pathname === "/mcp" && ["POST", "GET", "DELETE"].includes(req.method)) {
    const server = createMcp();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500).end("Internal error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

http.listen(port, () => console.log(`MCP on http://localhost:${port}/mcp`));
