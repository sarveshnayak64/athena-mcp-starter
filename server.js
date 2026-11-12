import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { fetchItems } from "./data.js";

const WIDGET_URI = "ui://widget/explorer.html";
const html = () => readFileSync("public/widget.html", "utf8");

const reply = (text, data) => ({
  content: [{ type: "text", text }],
  structuredContent: data,
});

function createMcp() {
  const server = new McpServer({ name: "athena-data-explorer", version: "0.1.0" });

  server.registerResource("explorer-widget", WIDGET_URI, {}, async () => ({
    contents: [{
      uri: WIDGET_URI,
      mimeType: "text/html+skybridge",
      text: html(),
      _meta: {
        "openai/widgetPrefersBorder": true,
        "openai/widgetDescription": "Interactive explorer of live public data.",
        // add any domains the widget itself fetches from (images etc.)
        "openai/widgetCSP": { connect_domains: [], resource_domains: ["https://flagcdn.com"] },
      },
    }],
  }));

  server.registerTool(
    "explore_data",
    {
      title: "Explore live data",
      description:
        "Use this when the user wants to look up, browse, search or compare live public data. Returns an interactive widget.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search, e.g. a name"),
        category: z.string().optional().describe("Optional category filter, e.g. a region"),
        limit: z.number().int().min(1).max(50).optional().describe("Max items, default 20"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Fetching live data",
        "openai/toolInvocation/invoked": "Data loaded",
      },
    },
    async ({ query = "", category = "", limit = 20 }) => {
      try {
        const data = await fetchItems({ query, category, limit });
        return reply(`Found ${data.items.length} items from ${data.source}.`, { ...data, query, category });
      } catch (e) {
        return reply(`Could not fetch data: ${e.message}`, { items: [], error: e.message, query, category });
      }
    }
  );
  return server;
}

const port = Number(process.env.PORT ?? 8787);
const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    }).end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end("Athena MCP server OK");
    return;
  }
  if (url.pathname === "/mcp" && ["POST", "GET", "DELETE"].includes(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const server = createMcp();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500).end("Internal error"); }
    return;
  }
  res.writeHead(404).end("Not Found");
});
http.listen(port, () => console.log(`MCP on http://localhost:${port}/mcp`));
