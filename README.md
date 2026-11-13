# Git Graph for Paseo

A [Paseo](https://paseo.sh) plugin that adds a Source Control panel to every workspace, modelled on the one in VS Code: the workspace's repositories, the selected repository's working tree, and its commit graph. Each scrolls on its own, and the lines between them drag to resize them.

- **Repositories**: the repositories VS Code would list for the workspace's folder, each with its branch and, when it differs from its upstream, the commits to pull and to push (`2↓ 1↑`). Selecting one shows it in the rest of the panel.
- **Changes**: commit message, the Commit button, and the staged files, changed files and files in conflict as trees of folders. Stage, unstage and discard a file or everything in a folder; stage or unstage everything from the group's title. The arrow at the right of the Commit button opens the other ways to commit: **Commit (Amend)** folds what is staged into the last commit, and rewords it when a message is written.
- **Graph**: one row per commit with its lanes, merges, branch names, remote branches and tags. The scope switch shows all branches (`All`, the default) or the checked-out branch with its upstream (`Auto`). Selecting a commit shows its message and its changed files, as a tree too. Fetch, pull and push sit in the title bar.
- **Diff**: selecting a file opens its diff in a workspace tab.

The panel reads the selected repository again every three seconds, and the list of repositories every ten, so commits made by agents show up without a refresh. Nothing is fetched on its own: the commits to pull are counted against what the last fetch brought. Resting the pointer on a button says what it does.

## Which repositories are listed

The same ones VS Code's git extension opens for the folder:

- the repository at the workspace's folder itself;
- the repositories in its subfolders, one level down by default;
- a repository whose root lies above the folder is not listed. When the folder has no repository of its own, the panel offers to open that one.

These settings are read from the folder's `.vscode/settings.json`, with VS Code's meaning and defaults:

| Setting | Default |
| --- | --- |
| `git.autoRepositoryDetection` | `true` |
| `git.repositoryScanMaxDepth` | `1` |
| `git.repositoryScanIgnoredFolders` | `["node_modules"]` |
| `git.scanRepositories` | `[]` |
| `git.ignoredRepositories` | `[]` |
| `git.openRepositoryInParentFolders` | `"prompt"` |

VS Code's user-level settings are not read, and submodules and worktrees are not added on their own.

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

The daemon half has one runtime dependency, `strip-json-comments`; the manifest's `build` step installs it when Paseo installs the plugin from Git.

After changing the code, `paseo plugin reload git-graph` compiles it again. `paseo plugin ls git-graph --json` shows a compile error, `paseo plugin logs git-graph` the daemon half's output.

## Layout

```text
index.client.tsx   registers the Source Control panel and the diff tab
index.server.ts    registers the RPC handlers
shared/git.ts      the RPC contracts
server/git.ts      runs git and reads its output
server/repositories.ts  finds the workspace's repositories
client/Repositories.tsx the repository list
client/Split.tsx        the three sections and the lines that resize them
client/lanes.ts    gives every commit a lane
client/Graph.tsx   draws the graph rows
client/Changes.tsx the working tree part
client/tree.ts     arranges changed files as a tree of folders
client/Files.tsx   draws that tree
client/Diff.tsx    the diff tab
client/Panel.tsx   puts the panel together
test/              node:test suites for the git reader, the repository search, the lanes, the file tree and the patch reader
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
