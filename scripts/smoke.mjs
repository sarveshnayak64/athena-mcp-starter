// End-to-end smoke test against a running server: npm start, then npm run smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = new URL(process.env.MCP_URL ?? "http://localhost:8787/mcp");
const client = new Client({ name: "earthquake-smoke-test", version: "1.0.0" });

await client.connect(new StreamableHTTPClientTransport(base));

const tools = await client.listTools();
const tool = tools.tools.find((item) => item.name === "explore_earthquakes");
if (!tool) throw new Error("explore_earthquakes tool is missing");
console.log(`tool ok: ${tool.name}`);

const result = await client.callTool({
  name: "explore_earthquakes",
  arguments: { days: 7, minMagnitude: 4.5, limit: 10 },
});
const data = result.structuredContent;
if (!data || !Array.isArray(data.items) || !data.items.length) {
  throw new Error("tool returned no earthquake items");
}
console.log(
  `data ok: ${data.items.length} events, strongest M${data.stats.maxMagnitude}, ` +
  `first=${data.items[0].place} (${data.items[0].depthKm} km)`,
);

const filtered = await client.callTool({
  name: "explore_earthquakes",
  arguments: { place: "Japan", minMagnitude: 4.5, maxDepth: 100, days: 30, limit: 20 },
});
const filteredData = filtered.structuredContent;
if (!filteredData.items.length) throw new Error("place filter returned no matches");
if (filteredData.items.some((item) => !item.place.toLowerCase().includes("japan"))) {
  throw new Error("place filter returned a non-matching event");
}
if (filteredData.items.some((item) => item.depthKm > 100)) {
  throw new Error("maxDepth filter returned a deeper event");
}
console.log(`filters ok: ${filteredData.items.length} Japan events at <=100 km depth`);

const widgetUri = tool._meta?.["openai/outputTemplate"];
if (!widgetUri) throw new Error("tool is missing openai/outputTemplate");
const resource = await client.readResource({ uri: widgetUri });
const html = resource.contents?.[0]?.text ?? "";
if (!html.includes("Earthquake activity")) throw new Error("widget HTML is missing its title");
if (html.includes("__LAND_PATH__")) throw new Error("widget land path was not injected");
console.log(`widget ok: ${resource.contents[0].mimeType}, ${html.length} chars`);

await client.close();
console.log("smoke test passed");
