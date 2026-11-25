# Past Sessions (powermods-past-sessions)

A Claude Code mod that shows the current project's past sessions in a side pane. Search them by title, prompt or branch, or select a session to see what it was about: its title, the task you started it with, your last request, when it ran, how many prompts it has, and its git branch. From there you can **resume** it as the main session, **pin** it so it always sits on top, or **archive** it so it stops showing.

> **Claude Code only.** Runs in the Claude Code CLI (v2.1.287+), the Desktop app's Code tab (v2.1.286+) and the VS Code extension (v2.1.299+ for panes). It does nothing in claude.ai chat or Cowork.

It reads your own Claude Code transcripts on this computer to list them, shows them only to you, stores nothing it reads, and sends nothing anywhere. See [Data, network and permissions](#data-network-and-permissions) and the privacy statement in [PRIVACY.md](PRIVACY.md).

![The Sessions pane: session titles in orange, a pinned session on top, recent sessions below with their ages, the selected session open in an orange card showing its task, last request, dates, prompt count, branch and Resume, Pin, Archive and Copy actions, a Search button in the header, and More and Archived buttons at the bottom](docs/pane.png)

*The pane with sample sessions: one pinned, one selected and open in its card, the list collapsed to the newest five.*

## Look

- Session titles are drawn in Claude's orange (your theme's `claude` color), so they stand out from labels and dates. Archived sessions, and ones still being read, are dim.
- The selected session opens into a rounded card with its task, last request, when it started and was last active, its prompt count, branch and size, and its actions. **Resume** is the highlighted button; Pin, Archive and Copy sit beside it with their hotkeys.
- While the pane has focus and nothing is open, a hint line at the bottom says how to move around.

## Search

- Press `s` (or **Search**) and type. Every word has to appear somewhere in a session's title, first prompt, last prompt or branch, or at the start of its id. Case doesn't matter.
- Results show every match, not collapsed, newest first with pinned ones on top. Archived matches are listed under **Archived**, so a search finds those too.
- Searching reads every transcript in the project (once per session: what it read is kept in memory until the session ends). While it reads, the pane says how many are left.
- Enter in the search field opens the top match with **Resume** focused, so Enter again resumes it.
- While the search field has focus, letters go into it rather than to the hotkeys. Tab or Up/Down moves out of it.

## Ordering and collapsing

- Pinned sessions come first, then everything else. Both groups are sorted by date, with the most recently active session on top.
- The list starts collapsed: every pinned session plus the 5 newest others. **More… (n)** shows the rest, and **Less…** collapses the list again.
- Archived sessions are left out of the list. **Archived (n)** shows them at the bottom so you can unarchive one. Archiving a pinned session also unpins it.
- The session you are in now is never listed. Sessions that contain no prompts, or only bare commands like `/clear`, are skipped.

## Install

Inside Claude Code:

```text
/plugin marketplace add netgfx/past-sessions-mod
/plugin install powermods-past-sessions@past-sessions-mod
/reload-plugins
```

Or in one step (Claude Code v2.1.275 or later): `/plugin install powermods-past-sessions --marketplace netgfx/past-sessions-mod`.

From a shell (both shells):

```text
claude plugin marketplace add netgfx/past-sessions-mod
claude plugin install powermods-past-sessions@past-sessions-mod --scope user
```

### Upgrading from past-sessions

Up to 0.2.0 the plugin was named `past-sessions`. The marketplace maps the old name to the new one, so Claude Code moves an existing install and its settings over; because the marketplace comes from GitHub, run `/plugin install powermods-past-sessions@past-sessions-mod` once after updating. On its first start the renamed plugin copies your pins and archive marks from the old `past-sessions` store. Versions before 0.3.0 also cached each session's title and first and last prompt in that store; those are not copied. To remove them, delete the file whose name starts with `past-sessions_` in `~/.claude/plugins/store/` (on Windows `%USERPROFILE%\.claude\plugins\store\`), after the upgrade.

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
| Search | `s`, or press **Search**, then type. Enter opens the top match; `x` or **Clear** ends the search. `/past-sessions search <text>` opens the pane already searching |
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
- Each summary is kept in memory for the current session only, and kept while a transcript's size and modification time don't change. Nothing read from a transcript is written anywhere: a new session reads the transcripts again.
- Transcripts over 4 MiB are summarized from their first and last megabyte, read with `$.fs.read`'s `offset` and `length` (Claude Code v2.1.326 or later) and cut to whole lines. No program is started. Their prompt count is shown as a lower bound (`6+ prompts`). On Claude Code earlier than v2.1.326, which can't read part of a file, such a session shows as *(large session: could not read)*.
- Pins and archive marks are `$.store` keys (`pin:<id>`, `archive:<id>`) that hold only the session id. They are shared by every Claude Code session on the machine, so they still apply after you restart.
- The list is re-read every 60 seconds while the pane is open, and after `/clear`, `/resume` or `/branch`.

## Data, network and permissions

In short, for reviewers (each point is detailed below):

- **Slash commands it runs:** `/resume <session id>`, with `$.command.run`, only when you press **Resume** on a session in the pane (or Enter on its Resume button). It switches this window to that past session, as typing `/resume <session id>` would. It runs no other command.
- **Programs it runs:** none. **Files it writes:** none. **Hosts it contacts:** none. **What it sends:** nothing; what it reads from transcripts stays in memory and in the pane.
- **Prompts it submits, tools it calls, permission decisions, environment variables / config it sets:** none.
- **Hooks:**
  - `session.start`: copies pin and archive marks from the old name once, deletes old cached summaries from its own store, registers `/past-sessions`, and starts a 60-second re-scan while the pane is open. Changes nothing in the session.
  - `classic.SessionStart` (after `/clear`, `/resume` or `/branch`): notes the new session id so the session you just left joins the list. Changes nothing.
  - `command.run` for `/past-sessions`: answers its own command (open, close, refresh, search).
  - `ui.close`: notes that its own pane closed. Changes nothing.
  - `ui.render` on the band above the prompt: returns Claude Code's own drawing unchanged; it only uses the event to open the pane on start when it can dock beside the transcript (`auto_open`).
  - `ui.render` on its pane: draws the session list.

**What it reads.** Your own Claude Code transcripts for the current project: `~/.claude/projects/<project>/*.jsonl` (on Windows `%USERPROFILE%\.claude\projects\<project>\*.jsonl`), where `<project>` is the folder Claude Code names after the session's working directory. If `CLAUDE_CONFIG_DIR` is set, it reads under that folder instead. The home folder comes from `USERPROFILE` or `HOME`. It reads only transcripts of this project, never the session you're in, and only the ones it has to show: when the list is collapsed, the newest few and your pinned ones; when you search, all of them. Once, after the rename, it also reads files named `past-sessions_*.json` in Claude Code's plugin store folder, to copy your pins and archive marks.

**What it does with what it reads.** It draws each session's title, first and last prompt, dates, prompt count, git branch and size in the pane, for you only. Summaries are kept in memory for the session and never written to disk, to `$.store`, or anywhere else, and never sent to a model.

**What goes into `$.store`** (shared by every Claude Code session on this machine): `pin:<session id>` and `archive:<session id>`, holding only `true`, until you unpin or unarchive the session; and `migrated:past-sessions`, marking that the one-time copy ran. On start it deletes any `summary:<id>` entries an earlier version left in this plugin's store.

**What it runs.** `/resume <session id>`, with `$.command.run`, only when you press **Resume** (or Enter on it). If that's refused, it copies `claude --resume <session id>` to your clipboard; **Copy** does the same. No program is started (`$.process.run` isn't used), and no file is written.

**Hosts reached.** None. It makes no network requests and sends nothing anywhere (`network.hosts` is empty). It makes no model calls, submits no prompts, adds nothing to Claude's system prompt, and doesn't observe, approve or change any tool call. It changes no environment variable and reads no settings file.

**Mods API calls**, as `claude plugin validate` lists them: `$.fs.list`, `$.fs.read`, `$.fs.exists`, `$.store.get`/`set`/`delete`/`keys`, `$.env.get` (`CLAUDE_CONFIG_DIR`, `USERPROFILE`, `HOME`), `$.session.id`/`cwd`/`root`, `$.command.register`, `$.command.run` (`/resume` only), `$.ui.open`/`close`/`panes`/`focus`/`copy`/`toast`/`log`/`invalidate`/`resolve`, `$.clock.every`/`after`/`now`.

## Develop

```text
claude plugin validate .
claude plugin test .
```

CI runs `claude plugin validate --profile directory --strict .` and `claude plugin test .` on Linux and Windows (`.github/workflows/validate.yml`). Every pane test runs with both a Windows-shaped and a POSIX-shaped fixture.

The pure logic (parsing, ordering, collapsing) is in `hooks/lib.js`, the drawing is in `hooks/view.js`, and the hooks are in `hooks/register.js`. Tests are in `tests/`.

Its tests run on Claude Code 2.1.331, on Windows 11. Requires Claude Code 2.1.287 or later; reading transcripts over 4 MiB needs v2.1.326 or later.

## License

MIT
