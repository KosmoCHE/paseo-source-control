# Working on the Source Control plugin

- Read `docs/design.md` before changing what the panel does. A new difference from VS Code goes into its table, with the reason.
- Changing what the panel does means updating `docs/features.md`.
- Take behaviour, wording, defaults and colours from VS Code 1.142.0's source (checkout command in `docs/design.md`), never from memory, and name what is copied in the code.
- Never read VS Code's user-level settings. The workspace's `.vscode/settings.json` is read only for the settings the README lists.
- No action switches or creates branches.
- Every button has a hover hint. UI text is English, VS Code's own strings where VS Code has them.
- Keep work bounded however large the repository: no unbounded git output, no list drawn in full.
- Test repositories, scratch scripts and the VS Code checkout go in the ignored `tmp/`.
- Everything committed here is public: no personal paths, user names, internal hosts, tokens or private data in code, docs, tests or commit messages.
- Format `client/` with `npx prettier --print-width 200` and `shared/git.ts` with `--print-width 160`; `server/` and `test/` are formatted by hand. Leave the existing drift in `client/ui.tsx`'s `T` and in `client/codicons.ts`.
- After a change: `npm run typecheck`, `npm test`, a look in the preview, then `paseo plugin reload source-control` and `paseo plugin ls` to see it running. Ask before restarting Paseo or disabling and enabling the plugin: it interrupts the agents.
