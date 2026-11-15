# Source Control for Paseo

A [Paseo](https://paseo.sh) plugin that adds a Source Control panel to every workspace, modelled on the one in VS Code: the workspace's repositories, the selected repository's working tree, and its commit graph. Each scrolls on its own under a title bar that stays put, and each folds from its title bar. As in VS Code, the repository list is as tall as its repositories, ten at most (on a phone, a quarter of the panel at most), and the line between the changes and the graph drags to resize them.

- **Repositories**: the repositories VS Code would list for the workspace's folder. Each shows its branch marked as VS Code marks it, `*` for changed or untracked files, `+` for staged ones and `!` while a merge or rebase is under way, with the branch icon to match; and, when it differs from its upstream, the commits to pull and to push (`2↓ 1↑`). Selecting one shows it in the rest of the panel.
- **Changes**: commit message, the Commit button, and the staged files, changed files and files in conflict as trees of folders. Stage, unstage and discard a file or everything in a folder; stage, unstage or discard everything from the group's title. Discarding asks first in VS Code's words; untracked files go to the Trash (on macOS 15 or later; where the Trash cannot take them, it asks whether to delete them for good, as VS Code does). Staging a file in conflict asks first while it still holds conflict markers, and, for a file deleted on one side, whether to keep it or delete it. A commit takes only the author git is configured with, never one git guesses. While the files scroll, the title of their group and the folders they are in stay at the top, one under the other, as VS Code's sticky scroll keeps them: seven at most and no more than 40% of the list, over a thin shadow. Pressing one scrolls back to where it starts; its chevron folds it. **Open File** opens a changed file in Paseo's own file tab, as its file tree does. As in VS Code, the button under the message does what fits the repository now: **Commit** while there is anything to commit; **Continue** while a merge or rebase is under way; else **Publish Branch** for a branch with no upstream, or **Sync Changes** `1↓ 2↑` when the branch and its upstream differ, which asks first and then pulls, and pushes if the branch had commits to push. Committing with nothing staged asks, in VS Code's words, whether to stage everything and commit it. The arrow at the right of the Commit button opens the other ways to commit: **Commit (Amend)** folds what is staged into the last commit, and rewords it when a message is written; **Commit & Push** and **Commit & Sync** do the one after the other. The message box grows with its message to ten lines, commits on ⌘Enter (Ctrl+Enter off a Mac), empties on Escape, and, at its start or end, steps with ↑ and ↓ through the messages committed while the app runs. It starts from the merge's message during a merge, from the commit being applied during a rebase, and from git's `commit.template`. Unlike VS Code, which opens an editor for an empty message, the panel waits for one.
- **Graph**: one row per commit with its lanes, merges, branch names, remote branches and tags. The scope switch shows all branches (`All`, the default) or, as VS Code's Auto does, the checked-out branch, its upstream and the branch it was made from (`Auto`). Branch names are coloured as VS Code colours them: the checked-out branch in the theme's accent, its upstream purple, and the branch it was made from orange; with all branches shown, every other branch and tag takes its lane's colour, and in `Auto` they are not named. The branch it was made from is found as VS Code finds it: the `vscode-merge-base` VS Code keeps in the branch's git config, else the branch the reflog says it was created from, else the remote's default branch. As in VS Code, when the checked-out branch and its upstream have parted, two rows with a dashed dot show what lies on either side of where they parted: **Incoming Changes**, on the upstream's lane just above that commit, and **Outgoing Changes**, just above the checked-out commit. Selecting one lists the files a pull would bring or a push would send, compared with that commit. Resting the pointer on a commit shows a card, as VS Code's hover does: who made it and how long ago, its whole message, how many files, insertions and deletions it holds, its branches and tags, and its short hash with a button that copies it. The card waits as long as VS Code's does (1.5 seconds on a Mac, half a second elsewhere) and shows above the graph, clear of its rows; while it shows, resting on another commit for a moment brings up that one's. On a phone, where there is no pointer, a long press shows the card until something else is pressed. In every list the row under the pointer is lit, in VS Code's colour. Selecting a commit lists the files it changed, as a tree too. Fetch, pull and push sit in the title bar.
- **Diff**: selecting a file opens a workspace tab that compares its two versions as VS Code's diff editor does, with VS Code's own diff algorithm (from the `vscode-diff` package, which gave the same results as VS Code 1.142's on the 939 file versions tried) and its defaults: lines numbered in both versions, removed lines red and added lines green in the colours of VS Code's default themes (Dark 2026 and Light 2026), the words that changed within them marked brighter, and changes only in leading or trailing whitespace ignored. Narrower than 900 pixels, the removed lines show above the added ones; wider, the two versions face each other. It opens at the first change, and is headed as VS Code titles it: `name.md (Working Tree)`, `(Index)`, `(Deleted)`, `(Incoming Changes)`, `(Outgoing Changes)`, or the commit. A file there on one side only, added, deleted or in conflict, shows as itself, as VS Code opens it; an untracked file opens in Paseo's file tab instead, on the desktop and in a browser. Code is set in Paseo's default code font at 16 pixels, its lines half as high again, and smoothed as VS Code smooths text by default; a changed word is marked the full height of its line. Unlike VS Code by default, long lines wrap. As VS Code's **Toggle Collapse Unchanged Regions** does, the map button in the tab's title folds the lines that did not change, but for the three beside each change; a folded stretch says how many lines it hides, its edges bring back 20 lines next to them when clicked or as many as they are dragged over, and its icon or a double click opens it whole; opened whole, an icon beside its first line folds it again. The button is off at first, and the tab remembers it. At the right of the diff, as in VS Code, an overview ruler marks in the whole file where lines were removed and where they were added, and shades the part in view; pressing it scrolls there, dragging moves the part in view, and the wheel scrolls over it. Phones have no ruler.

The panel reads the selected repository again every three seconds, and the list of repositories every ten, so commits made by agents show up without a refresh. As in VS Code, git status is read for 10000 files at most: past that, a warning under the commit box says only the first 10000 are listed, a notification says so once, the repository is read again only after a command, a fetch or **Refresh** in the Changes title, and a `node_modules` that git does not ignore can be added to `.gitignore` from the warning. Only the rows in view are drawn. A repository git cannot read is listed with why, beside the others. As VS Code does with `git.autofetch` on, the selected repository is fetched when the panel shows it and every three minutes after, waiting while the window is in the background, so commits pushed by others show up too; a failure is shown once, however often it repeats. The other repositories count the commits to pull against what their last fetch brought. Resting the pointer on a button says what it does.

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
git clone https://github.com/KosmoCHE/paseo-source-control.git
cd paseo-source-control
npm install
paseo plugin install "$(pwd)"
```

Open a workspace: **Source Control** is available as an explorer tab and as a workspace tab.

The daemon half has two runtime dependencies, `strip-json-comments` and `vscode-diff`; the manifest's `build` step installs them when Paseo installs the plugin from Git.

After changing the code, `paseo plugin reload source-control` compiles it again. `paseo plugin ls source-control --json` shows a compile error, `paseo plugin logs source-control` the daemon half's output.

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
client/overview.ts where the overview ruler's marks and slider go
client/OverviewRuler.tsx draws the ruler
client/Panel.tsx   puts the panel together
test/              node:test suites for the git reader, the repository search, the lanes, the rows of changes to pull and push, the times, the file tree, the rows kept at the top, the rows of a diff, its folded lines and its overview ruler
preview/           the panel in a browser, for development
```

A plugin's client cannot import an SVG library, and inline SVG is accepted for icons only, so the graph is built from plain views: a lane is a thin box, and a turn into or out of a commit's dot is a box with two borders and one rounded corner.

## Development

What the panel follows, and where it differs from VS Code and why, is in [docs/design.md](docs/design.md).

```bash
npm run typecheck
npm test
npm run preview    # then open http://127.0.0.1:4173/?cwd=/path/to/a/repository
```

The preview renders the real panel under React Native Web with stand-ins for the Paseo host, and answers its RPCs with the plugin's own daemon half, so the buttons act on the repository you point it at. Address parameters: `theme=light`, `compact`, `width=<sidebar width>`, and `press=<button name>|<button name>` to click through to a state.

The panel's icons are VS Code's own, from [vscode-codicons](https://github.com/microsoft/vscode-codicons) (CC BY 4.0). Only the icons of the two tabs, which sit among Paseo's own, are Lucide's.

## Limits

- The graph draws at most ten lanes side by side; lanes further right are cut off.
- Diffs have no syntax colours.
- Open File is offered on the desktop and in a browser only. A plugin has no call yet to open a file in Paseo's file tab, so the panel presses a hidden Markdown link to the file instead, which needs a web page ([issue #1](https://github.com/KosmoCHE/paseo-source-control/issues/1)).
- Fetch, pull, push and the fetch every three minutes run with the daemon's git credentials and cannot answer a password prompt.
- Switching and creating branches is left to the agents: the panel has no such actions.
