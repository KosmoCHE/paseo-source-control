// Builds the browser preview: the panel under React Native Web, with stand-ins for the
// Paseo host, and the plugin's real daemon half for serve.mjs to answer with.

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

/** The two modules the host supplies at run time. */
const host = {
  name: "host",
  setup(esbuild) {
    esbuild.onResolve({ filter: /^@getpaseo\/plugin\/client$/ }, () => ({ path: join(here, "host", "client.tsx") }));
    esbuild.onResolve({ filter: /^@getpaseo\/plugin\/client\/ui$/ }, () => ({ path: join(here, "host", "ui.tsx") }));
  },
};

await build({
  entryPoints: [join(here, "main.tsx")],
  outfile: join(dist, "preview.js"),
  bundle: true,
  jsx: "automatic",
  target: "es2022",
  alias: { "react-native": "react-native-web" },
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [host],
});

await build({
  entryPoints: [join(here, "..", "index.server.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
});
