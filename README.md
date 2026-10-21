# past-sessions-mod

A Claude Code mod that shows the current project's past sessions in a side pane. Select a session to see what it was about: its title, the task you started it with, your last request, when it ran, how many prompts it has, and its git branch. From there you can **resume** it as the main session, **pin** it so it always sits on top, or **archive** it so it stops showing.

```text
Past sessions · 12                    refresh
Pinned
  Login bug fix on Windows                 2d
Recent
> Pull button feature                      3h
    Task
    add a pull button as well so we can pull from remote
    Last request
    bump to 0.3.0 and commit
    Started Oct 5 2026, 21:10
    Last active Oct 5 2026, 23:37
    3 prompts · branch main · 538 KB
    3a07c375-ab56-4dfa-a20a-cd4ed30064a0
    [ r: Resume ] [ p: Pin ] [ a: Archive ] [ c: Copy ]
  Branch search and checkout autocomplete  9d
  ...
More… (7)   Archived (2)
```

## Ordering and collapsing

- Pinned sessions come first, then everything else. Both groups are sorted by date, with the most recently active session on top.
- The list starts collapsed: every pinned session plus the 5 newest others. **More… (n)** shows the rest, and **Less…** collapses the list again.
- Archived sessions are left out of the list. **Archived (n)** shows them at the bottom so you can unarchive one. Archiving a pinned session also unpins it.
- The session you are in now is never listed. Sessions that contain no prompts, or only bare commands like `/clear`, are skipped.

## Install

From the marketplace (both shells):

```text
claude plugin marketplace add netgfx/past-sessions-mod
claude plugin install past-sessions@past-sessions-mod --scope user
```

Or, inside Claude Code: `/plugin marketplace add netgfx/past-sessions-mod`, then `/plugin install past-sessions@past-sessions-mod`, then `/reload-plugins`.

To develop against a checkout:

```bash
# macOS / Linux
claude --plugin-dir ~/src/past-sessions-mod
```

```powershell
# Windows PowerShell
claude --plugin-dir $HOME\src\past-sessions-mod
```

## Use

| Action | How |
|---|---|
| Toggle the pane | `/past-sessions` (or `/past-sessions open`, `/past-sessions close`) |
| Re-read the folder | `/past-sessions refresh`, or press **refresh** in the pane |
| Show a session's details | Click its row, or Tab/Up/Down to it and press Enter |
| Resume / Pin / Archive / Copy | `r` / `p` / `a` / `c` while the pane has focus, or click the buttons |
| More… / Less… | `m` |
| Show / hide archived | `h` |
| Give the pane focus | Click it, or Ctrl+X then Tab. Esc gives focus back to the prompt |

**Resume** runs `/resume <session-id>`, as if you had typed it. If the session can't switch from where you are, the mod copies `claude --resume <session-id>` to the clipboard so you can run it in a terminal. **Copy** always copies that command.

The pane opens on its own when a session starts, but only if it can dock beside the transcript: in the fullscreen terminal layout (`CLAUDE_CODE_NO_FLICKER=1`) or in Claude Desktop's Code tab. To turn that off, set **Open on start** (`auto_open`) to off in `/config`. `/past-sessions` opens the pane in any layout.

## How it works

- It reads `~/.claude/projects/<project>/*.jsonl` (on Windows, `%USERPROFILE%\.claude\projects\...`). If `CLAUDE_CONFIG_DIR` is set, it reads under that folder instead.
- A session's title is its `/rename` name if it has one, otherwise the title Claude Code generated, otherwise the first line of its first prompt.
- Transcripts are read one at a time in the background. When the list is collapsed, only the sessions you can see are read.
- Each summary is cached in the mod's `$.store`, keyed by the file's size and modification time, so a transcript is read again only when it changes. Transcripts over 4 MiB are summarized from their first and last 150 lines: through `powershell` on Windows and `/bin/sh` with `head`/`tail` on macOS and Linux. Their prompt count is shown as a lower bound (`6+ prompts`).
- Pins and archive marks are `$.store` keys (`pin:<id>`, `archive:<id>`). They are shared by every Claude Code session on the machine, so they still apply after you restart.
- The list is re-read every 60 seconds while the pane is open, and after `/clear`, `/resume` or `/branch`.

### Mods API calls

`$.fs.list`, `$.fs.read`, `$.fs.exists`, `$.store.*`, `$.env.get` (`CLAUDE_CONFIG_DIR`, `USERPROFILE`, `HOME`), `$.session.id`/`cwd`/`root`, `$.command.register`, `$.command.run` (`/resume` only), `$.process.run` (only for transcripts over 4 MiB), `$.ui.open`/`close`/`panes`/`copy`/`toast`/`log`/`invalidate`, `$.clock.every`/`after`/`now`. It makes no network calls and writes no files.

## Develop

```text
claude plugin validate .
claude plugin test .
```

The pure logic (parsing, ordering, collapsing) is in `hooks/lib.js`, the drawing is in `hooks/view.js`, and the hooks are in `hooks/register.js`. Tests are in `tests/`.

Tested with Claude Code 2.1.306 on Windows 11. Requires Claude Code 2.1.287 or later.

## License

MIT
