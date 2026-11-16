# Working on the plugin

What the panel follows, and where it differs from VS Code and why, is in [design.md](design.md); what it does, in [features.md](features.md).

## Commands

```bash
npm install
npm run typecheck
npm test
npm run preview    # then open http://127.0.0.1:4173/?cwd=/path/to/a/repository
```

After changing the code, `paseo plugin reload source-control` compiles it again. `paseo plugin ls source-control --json` shows a compile error, `paseo plugin logs source-control` the daemon half's output.

The daemon half has two runtime dependencies, `strip-json-comments` and `vscode-diff`; the manifest's `build` step installs them when Paseo installs the plugin from Git.

## Preview

The preview renders the real panel under React Native Web with stand-ins for the Paseo host, and answers its RPCs with the plugin's own daemon half, so the buttons act on the repository you point it at. Address parameters: `theme=light`, `compact`, `width=<sidebar width>`, and `press=<button name>|<button name>` to click through to a state.

## Layout

```text
index.client.tsx   registers the Source Control panel and the diff tab
index.server.ts    registers the RPC handlers
shared/git.ts      the RPC contracts
server/git.ts      runs git and reads its output
server/diff.ts     compares a file's two versions as VS Code's diff editor does
server/repositories.ts  finds the workspace's repositories
client/Repositories.tsx the repository list
client/Split.tsx        the three sections, their title bars and the line that resizes them
client/lanes.ts    gives every commit a lane
client/ago.ts      says how long ago a commit was, in VS Code's words
client/pending.ts  adds the rows of changes to pull and to push
client/Graph.tsx   draws the graph rows
client/Changes.tsx the working tree part
client/sticky.ts   which rows stay at the top of a scrolling tree
client/StickyList.tsx draws them there
client/openFile.tsx opens a file in Paseo's file tab
client/fileLink.ts the link it opens the file with
client/tree.ts     arranges changed files as a tree of folders
client/Files.tsx   draws that tree
client/codicons.ts the icons taken from VS Code
client/Diff.tsx    the diff tab
client/diffRows.ts lays a diff out in rows, inline or side by side
client/unchanged.ts folds the unchanged lines of a diff
client/wrap.ts     wraps a diff's long lines as VS Code's editor wraps them
client/overview.ts where the overview ruler's marks and slider go
client/OverviewRuler.tsx draws the ruler
client/Panel.tsx   puts the panel together
test/              node:test suites for the git reader, the repository search, the lanes, the rows of changes to pull and push, the times, the file tree, the rows kept at the top, the rows of a diff, its folded lines, its wrapped lines and its overview ruler
preview/           the panel in a browser, for development
```

A plugin's client cannot import an SVG library, and inline SVG is accepted for icons only, so the graph is built from plain views: a lane is a thin box, and a turn into or out of a commit's dot is a box with two borders and one rounded corner.
