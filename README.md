# Git Graph for Paseo

A [Paseo](https://paseo.sh) plugin that adds a Source Control panel to every workspace, modelled on the one in VS Code: the working tree on top, the commit graph below, each scrolling on its own.

- **Changes**: commit message, Commit and Amend buttons, staged files, changed files, files in conflict. Stage, unstage and discard per file; stage or unstage everything from the group's title. Amend folds what is staged into the last commit, and rewords it when a message is written.
- **Graph**: one row per commit with its lanes, merges, branch names, remote branches and tags. The scope switch shows all branches (`All`, the default) or the checked-out branch with its upstream (`Auto`). Selecting a commit shows its message and changed files. Fetch, pull and push sit in the title bar.
- **Diff**: selecting a file opens its diff in a workspace tab.

The panel reads the repository again every three seconds, so commits made by agents show up without a refresh. A workspace whose directory lies inside a larger repository shows that repository.

## Requirements

- Paseo 0.14.0 or later, with plugins enabled
- `git` on the daemon's `PATH`

## Install from a checkout

```bash
git clone https://github.com/KosmoCHE/paseo-plugin-git-graph.git
cd paseo-plugin-git-graph
npm install
paseo plugin install "$(pwd)"
```

Open a workspace: **Source Control** is available as an explorer tab and as a workspace tab.

After changing the code, `paseo plugin reload git-graph` compiles it again. `paseo plugin ls git-graph --json` shows a compile error, `paseo plugin logs git-graph` the daemon half's output.

## Layout

```text
index.client.tsx   registers the Source Control panel and the diff tab
index.server.ts    registers the RPC handlers
shared/git.ts      the RPC contracts
server/git.ts      runs git and reads its output
client/lanes.ts    gives every commit a lane
client/Graph.tsx   draws the graph rows
client/Changes.tsx the working tree part
client/Diff.tsx    the diff tab
client/Panel.tsx   puts the panel together
test/              node:test suites for the git reader, the lanes and the patch reader
preview/           the panel in a browser, for development
```

A plugin has no SVG, so the graph is built from plain views: a lane is a thin box, and a turn into or out of a commit's dot is a box with two borders and one rounded corner.

## Development

```bash
npm run typecheck
npm test
npm run preview    # then open http://127.0.0.1:4173/?cwd=/path/to/a/repository
```

The preview renders the real panel under React Native Web with stand-ins for the Paseo host, and answers its RPCs with the plugin's own daemon half, so the buttons act on the repository you point it at. Address parameters: `theme=light`, `compact`, `width=<sidebar width>`, and `press=<button name>|<button name>` to click through to a state.

## Limits

- The graph draws at most ten lanes side by side; lanes further right are cut off.
- Diffs are plain text, without syntax colours or line numbers.
- Fetch, pull and push run with the daemon's git credentials and cannot answer a password prompt.
- Switching and creating branches is left to the agents: the panel has no such actions.
