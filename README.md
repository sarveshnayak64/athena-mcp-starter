# Athena MCP Data Explorer
Node MCP server (Streamable HTTP) + interactive widget for Athena AI.

## Run
npm install && npm start      # http://localhost:8787/mcp
npm run inspect               # test in MCP Inspector
ngrok http 8787               # then use https://<id>.ngrok-free.app/mcp in Athena

## Swap the subject
Edit `data.js` only (API URL + mapping to {id,title,subtitle,value,category,image}), then tune the tool description in `server.js`.
