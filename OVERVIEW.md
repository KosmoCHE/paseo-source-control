Git Graph adds a Source Control panel to every workspace, modelled on the one in VS Code: the working tree on top, the commit graph below.

In the working tree part you write a commit message, stage and unstage files, discard changes, and commit what is staged or amend the last commit with it. Files in conflict are listed apart, and staging one marks it resolved.

The graph draws one row per commit with its branch lanes, merges, branch names, remote branches and tags. It shows all branches, or only the checked-out branch and its upstream. Selecting a commit shows its message and the files it changed. Fetch, pull and push sit in the graph's title bar.

Selecting a file anywhere in the panel opens its diff in a workspace tab. The two parts of the panel scroll separately.

The panel reads the repository again every three seconds, so commits made by agents appear on their own.

Setup: the daemon needs `git` on its `PATH`, and Paseo 0.14.0 or later. Fetch, pull and push use the daemon's own git credentials and cannot answer a password prompt.

Limits: the graph draws at most ten lanes side by side, and lanes further right are cut off. Diffs are plain text without syntax colours.
