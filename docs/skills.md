# Skills: which one for which job

Process skills come first, then the domain one. Check what's installed
before starting; this is the map for this repo.

| Job | Skill / tool | Notes |
|---|---|---|
| New feature or behaviour change | `superpowers:brainstorming` → `superpowers:writing-plans` | First ask whether it's a mod (see `CLAUDE.md`) |
| Carrying out a written plan | `superpowers:subagent-driven-development` | One implementer per task, roles in `AGENTS.md` |
| Any code change | `superpowers:test-driven-development` | Core: real-PTY tests in `core/crates/herdr-core/tests/`. App: `cargo test`, mod JS tests in `app/scripts/*.test.ts` |
| Bug or failing test | `superpowers:systematic-debugging` | Reproduce in a scratch home and session first |
| Before saying done | `superpowers:verification-before-completion` | Run the half's `just check`/`just test` and quote the output |
| Before merging | `/code-review high`, `superpowers:requesting-code-review` | `security-review` for anything touching network, exec, ssh or file access |
| Isolated work | `superpowers:using-git-worktrees` | One worktree per task |
| Finishing a branch | `superpowers:finishing-a-development-branch` | Merge to `main`, update Status in `CLAUDE.md` |
| UI: panels, menus, dialogs, layouts | `frontend-design`, `ui-ux-pro-max` | Built as mods (`app/defaults/mods/`, JS on GPUI). Verify with `herdr-app check` and `herdr-app shot` in a scratch home |
| Themes, palette | `ui-ux-pro-max:design-system` | Themes are `app/defaults/themes/*.json` |
| Pulling upstream | `superpowers:systematic-debugging` for conflicts | Procedure in `docs/upstream.md` |
| Running the app to see a change | `run` | Always with `HERDR_APP_HOME`/`HC_SESSION` scratch values |
| Diagrams for docs | `d2-diagram` | |

## Skills that ship inside the product

These are the product's own manuals for users' agents. Keep each in step with
the behaviour it describes, in the same commit.

- `app/src/SKILL.md`: printed by `herdr-app --skill`, how to drive the window.
- `app/defaults/AGENTS.md`: written into every user's app home, the mod and
  layout guide.
- `core/crates/herdr-core/src/SKILL.md`: printed by `hc --skill`, how to run and
  coordinate agents.
- `core/skills/herdr-core/SKILL.md`: the short installable stub.

P2 renames these with the product. Their tests (`app/tests/skill.rs`,
`core/crates/herdr-core/tests/skill.rs`) check they name every command and
setting.
