// Serves the preview on localhost and answers its RPCs with the plugin's real daemon half.
// Run `node preview/build.mjs` first, then open http://127.0.0.1:4173/?cwd=/path/to/a/repository

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import contribute from "./dist/server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pages = { "/": ["index.html", "text/html"], "/preview.js": ["dist/preview.js", "text/javascript"] };

const handlers = new Map();
contribute({ handle: (contract, handler) => handlers.set(contract.name, { contract, handler }) });

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  const send = (code, type, content) => response.writeHead(code, { "content-type": type }).end(content);
  if (request.method === "POST" && handlers.has(pathname.slice(5))) {
    const { contract, handler } = handlers.get(pathname.slice(5)); // after "/rpc/"
    try {
      send(200, "application/json", JSON.stringify(await handler(contract.input.parse(await body(request)))));
    } catch (error) {
      send(500, "application/json", JSON.stringify({ error: error.message }));
    }
  } else if (pages[pathname]) {
    const [file, type] = pages[pathname];
    send(200, type, await readFile(join(here, file)));
  } else send(404, "text/plain", "Not found");
}).listen(4173, "127.0.0.1", () => console.log("http://127.0.0.1:4173/?cwd=" + process.cwd()));
