# Claude Code status for AgentDeck

AgentDeck's Agents tab lists terminals whose program reports its state over
OSC 7501. Claude Code doesn't, so without this plugin its sessions never show.
The plugin's hooks report for it:

| Claude Code hook | Reported |
| --- | --- |
| SessionStart | idle |
| UserPromptSubmit, PostToolUse | working |
| PermissionRequest, Notification `permission_prompt` | blocked (permission) |
| Notification `elicitation_dialog` | blocked (question) |
| Stop | done |
| SessionEnd | cleared |

`hooks/status` writes the report to Claude's terminal, and only inside an
AgentDeck/hc terminal (`HC_TERMINAL_ID` set), so other terminals see nothing.
Only sessions running in AgentDeck panes can show; sessions in another
terminal app can't.

## Install

```sh
claude plugin marketplace add /path/to/agentdeck/integrations/claude-code
claude plugin install agentdeck-status@agentdeck
```

Restart running Claude sessions to pick it up.

## Known gaps

- Interrupting a turn (Esc) fires no hook, so it stays `working` until the
  next prompt.

## Test

`integrations/claude-code/test.sh` runs the hook against a scratch core
under `/var/tmp` (needs `core/target/debug/herdr-core`). No Claude run.
