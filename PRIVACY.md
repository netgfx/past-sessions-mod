# Privacy statement: Past Sessions (powermods-past-sessions)

Past Sessions is a Claude Code mod that lists the current project's past Claude Code sessions in a side pane, so you can search, resume, pin or archive them. It is published by Michael Dobekidis ([github.com/netgfx](https://github.com/netgfx)).

## What it reads

Your own Claude Code transcripts for the current project, stored by Claude Code on your computer at `~/.claude/projects/<project>/*.jsonl` (or under `CLAUDE_CONFIG_DIR` when that is set). From each one it shows you the title, first and last prompt, dates, prompt count, git branch and size. It reads only this project's transcripts, never the session you are in, and only the ones the pane has to show or search.

## What it collects and stores

Nothing is collected by the publisher. The mod has no server, no analytics and no telemetry.

Nothing it reads from a transcript is stored: summaries live in memory for the session and are discarded when it ends. The only things it stores are your pin and archive marks (`pin:<session id>`, `archive:<session id>`, which hold no text) and a marker that the one-time copy of those marks from the plugin's old name ran. They live in Claude Code's plugin store for this mod (`$.store`, under `~/.claude/plugins/store/`), which every Claude Code session on this computer can read.

## What leaves your computer

Nothing. The mod makes no network requests, sends nothing to any model or service, and starts no programs. Resuming a session runs Claude Code's own `/resume` command, in your session, when you press Resume.

## Retention

Pin and archive marks stay until you unpin or unarchive the session. Everything else lasts only for the session.

## How to delete it

Unpin or unarchive sessions in the pane, or uninstall the plugin with `claude plugin uninstall powermods-past-sessions@past-sessions-mod`. To clear its store as well, delete the file whose name starts with `powermods-past-sessions_` in `~/.claude/plugins/store/`. Versions before 0.3.0 (named `past-sessions`) cached session titles and prompt excerpts in a file starting with `past-sessions_` in the same folder: delete it to remove them.

## Sharing and sale

The publisher receives none of this data, and nothing is sold or shared with anyone.

## Children

The mod is a developer tool and is not directed at anyone under 18.

## Contact

Questions or requests: [github.com/netgfx/past-sessions-mod/issues](https://github.com/netgfx/past-sessions-mod/issues).
