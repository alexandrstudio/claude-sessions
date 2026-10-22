# claude-sessions: Claude Code mods for many sessions

Two mods for people who keep several Claude Code sessions going across
different projects:

- **[sessions](#sessions)**: `/sessions` lists every session across all
  projects, with the command to resume any of them.
- **[waiting](#waiting)**: every session shows which other sessions are waiting
  for you, and you get a notification when one starts waiting.

Install either or both. At the prompt of a terminal session:

```
/plugin install sessions --marketplace alexandrstudio/claude-sessions
/plugin install waiting --marketplace alexandrstudio/claude-sessions
```

Answer `y` to add the marketplace, then pick a scope (user scope loads the mod
in every session). From a shell:

```
claude plugin install sessions --marketplace alexandrstudio/claude-sessions
claude plugin install waiting --marketplace alexandrstudio/claude-sessions
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `alexandrstudio/claude-sessions`, then
Add plugin.

---

## sessions

`/sessions` opens a pane listing every Claude Code session you have had, across
**all** projects, newest first. `/resume` only shows the folder you are in; this
shows them all, and gives you the command to continue any of them.

```
  12m  code/notes                 Cross-project session browser   4
   2h  acme/video-service         Retry logic for uploads        85
   3d  acme/location-data         Spike for the map layer         2
```

Each row: how long ago, the project folder, the session's title (or first
prompt), and how many prompts you typed. Blue folders are on this machine,
yellow ones exist only in the archive (see below), and ● marks a session that
is running right now.

Everything is a button: click it (Claude Code's fullscreen mode reports
clicks) or Tab to it and press Enter.

```
[ Filter ]  [ Info ]  [ Settings ]  [ Refresh ]   71 of 71 sessions · 3 archive-only
```

- **[ Filter ]** opens a text field: words match title, first prompt and
  folder; `:archived` shows archive-only sessions, `:local` the ones not
  archived yet, `:running` the open ones. Enter keeps the filter,
  **[ Clear ]** removes it. Outside the field, your typing never lands in it.
- **Click a row** for the details and the resume command, `cd '<folder>' && claude -r <id>`:
  **[ Copy resume command ]** (paste it in a new terminal tab),
  **[ Restore to this Mac ]** for an archive-only session, **[ Move to archive ]**
  to remove the copy on this machine once the archive holds an identical one
  (press it twice), **[ Back ]**.
- **[ Info ]** explains all of this inside the pane; **[ Settings ]** holds the
  archive folder and the automatic archive.
- Without a mouse: **ctrl+x tab** gives the pane the keys, each button's letter
  is a shortcut (`f` filter, `i` info, `s` settings, `0` refresh, `c` copy,
  `b` back), and Esc hands the keys back to the prompt.

Requires `python3` on your `PATH` (it reads the transcripts and caches what it
read in `~/.claude/cache/sessions-mod-index.json`).

### The archive

Give the mod an archive folder and it keeps a second copy of your sessions
there, so `/sessions` still lists them after they are gone from
`~/.claude/projects`, and you can move old ones off your machine.

- **Set the folder** in the pane (**[ Settings ]** → **[ Set folder ]**, type it, Enter) or in
  `/config` under **sessions → Archive folder**, for example
  `/Volumes/MyDrive/claude-sessions/projects`. It is created on the first run.
  Leave it empty for no archive.
- **Archiving runs by itself** when a session starts and every 6 hours,
  copying new and changed sessions. It never deletes from the archive. An
  archive on an external drive waits until the drive is plugged in. Turn it
  off in the settings and use **[ Archive now ]** instead.

Don't put the archive in a git repository you push: transcripts hold whatever
the sessions saw, file contents and command output included.

### Keep your sessions longer

Claude Code deletes transcripts older than **30 days** by default. With the
archive running, that is fine: the archive keeps the old ones. Without an
archive, set `cleanupPeriodDays` in `~/.claude/settings.json` to keep them:

```json
{ "cleanupPeriodDays": 36500 }
```

Transcripts grow (roughly 0.5–1 GB a month of heavy use), so keep an eye on
`~/.claude/projects`.

### Optional: archive while Claude Code is closed

The mod only archives while a session is open. To archive on a schedule
regardless, [`sessions/extras/archive-sessions.sh`](sessions/extras/archive-sessions.sh)
does the same copy from a shell, and on macOS
[`sessions/extras/claude-session-archive.plist`](sessions/extras/claude-session-archive.plist)
runs it daily: fill in the two paths and follow the comment at its top. Give
the script the folder *above* `projects`; it writes into `projects/` inside it.

---

## waiting

When you work in several sessions at once, one of them often sits on a
permission prompt or a question while you are in another. With **waiting**
installed, every session shows a line above its prompt while another session
needs you:

```
⏳ 2 waiting · acme/video-service: permission for Bash (3m) · code/notes: has a question
```

The line is only there while something waits. A session that has waited for 15
seconds also sends a notification, *"Claude is waiting for you: <folder>:
<reason>"*, through your usual notification setting (`/config` →
notifications). A wait you answer within 15 seconds sends nothing.

Settings, in `/config` under **waiting**:

- **Notify** (on): the notification after 15 seconds.
- **Show finished sessions** (off): also list sessions whose turn has finished
  and that wait for your next prompt.

How it works: each session writes a small status file to
`~/.claude/cache/waiting/` and reads the others' every few seconds. A session
that is gone (closed, crashed) drops off the line within about 35 seconds.
Only sessions that have the mod loaded take part, so install it at user scope
and restart the sessions you already have open.

---

## License

MIT

Workflow stage: solo
