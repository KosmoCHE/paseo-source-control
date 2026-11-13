Git Graph adds a Source Control panel to every workspace, modelled on the one in VS Code: the workspace's repositories, the selected repository's working tree, and its commit graph.

The repositories are the ones VS Code would list for the workspace's folder: its own, and those one level down. Each shows its branch, marked as in VS Code when it has changed, staged or conflicting work, and, when it differs from its upstream, the commits to pull and to push. The folder's `.vscode/settings.json` is honoured for `git.scanRepositories`, `git.repositoryScanMaxDepth`, `git.autoRepositoryDetection`, `git.repositoryScanIgnoredFolders`, `git.ignoredRepositories` and `git.openRepositoryInParentFolders`.

In the working tree part you write a commit message, stage and unstage files, discard changes, and commit what is staged. Changed files are shown as a tree of folders, and a folder's buttons act on everything in it. The arrow at the right of the Commit button opens the other ways to commit, among them amending the last commit. Files in conflict are listed apart, and staging one marks it resolved.

The graph draws one row per commit with its branch lanes, merges, branch names, remote branches and tags. It shows all branches, or only the checked-out branch and its upstream. Selecting a commit shows its message and the files it changed. Fetch, pull and push sit in the graph's title bar.

Selecting a file anywhere in the panel opens its diff in a workspace tab. The three parts of the panel scroll separately, the lines between them drag to resize them, and the repository list and the graph fold from their title bars.

The panel reads the selected repository again every three seconds, so commits made by agents appear on their own. It does not fetch on its own: the commits to pull are counted against what the last fetch brought.

Setup: the daemon needs `git` on its `PATH`, and Paseo 0.14.0 or later. Fetch, pull and push use the daemon's own git credentials and cannot answer a password prompt.

Limits: the graph draws at most ten lanes side by side, and lanes further right are cut off. Diffs are plain text without syntax colours.
