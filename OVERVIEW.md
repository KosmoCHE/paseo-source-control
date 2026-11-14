Source Control adds a panel to every workspace, modelled on the one in VS Code: the workspace's repositories, the selected repository's working tree, and its commit graph.

The repositories are the ones VS Code would list for the workspace's folder: its own, and those one level down. Each shows its branch, marked as in VS Code when it has changed, staged or conflicting work, and, when it differs from its upstream, the commits to pull and to push. The folder's `.vscode/settings.json` is honoured for `git.scanRepositories`, `git.repositoryScanMaxDepth`, `git.autoRepositoryDetection`, `git.repositoryScanIgnoredFolders`, `git.ignoredRepositories` and `git.openRepositoryInParentFolders`.

In the working tree part you write a commit message, open changed files in Paseo's file tab, stage and unstage files, discard changes, and commit what is staged. Changed files are shown as a tree of folders, and a folder's buttons act on everything in it. The arrow at the right of the Commit button opens the other ways to commit, among them amending the last commit. Files in conflict are listed apart, and staging one marks it resolved. While the files scroll, the title of their group and the folders they are in stay at the top.

The graph draws one row per commit with its branch lanes, merges, branch names, remote branches and tags. It shows all branches, or only the checked-out branch and its upstream. Selecting a commit shows its message and the files it changed. Fetch, pull and push sit in the graph's title bar.

Selecting a file anywhere in the panel opens its diff in a workspace tab; an untracked file opens in Paseo's file tab instead, on the desktop and in a browser. The three parts of the panel scroll separately under title bars that stay put, and each folds from its title bar. As in VS Code, the repository list is as tall as its repositories, ten at most, and the line between the working tree and the graph drags to resize them.

The panel reads the selected repository again every three seconds, so commits made by agents appear on their own. It does not fetch on its own: the commits to pull are counted against what the last fetch brought.

Setup: the daemon needs `git` on its `PATH`, and Paseo 0.14.0 or later. Fetch, pull and push use the daemon's own git credentials and cannot answer a password prompt.

Limits: the graph draws at most ten lanes side by side, and lanes further right are cut off. Diffs are plain text without syntax colours.
