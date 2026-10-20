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
yellow ones exist only in the archive (see below).

- **Type** to filter (words match title, first prompt, folder). Enter opens the first match.
- **Pick a row** for the details and the resume command, `cd '<folder>' && claude -r <id>`:
  - `c` copies the command; paste it in a new terminal tab.
  - `r` restores an archive-only session, so the command works again.
  - `b` goes back to the list.
- `0` refreshes the list, Esc closes the pane.

Requires `python3` on your `PATH` (it reads the transcripts and caches what it
read in `~/.claude/cache/sessions-mod-index.json`).

### Keep your sessions longer (recommended)

Claude Code deletes transcripts older than **30 days** by default, so the list
only reaches back a month. To keep them, set `cleanupPeriodDays` in
`~/.claude/settings.json`:

```json
{ "cleanupPeriodDays": 36500 }
```

Transcripts grow (roughly 0.5–1 GB a month of heavy use), so keep an eye on
`~/.claude/projects`, or archive them elsewhere as below.

### Optional: an archive folder

Keep a second copy of your sessions on another disk, and `/sessions` lists those
too, even after they are gone from `~/.claude/projects`.

1. Copy them nightly with [`sessions/extras/archive-sessions.sh`](sessions/extras/archive-sessions.sh):

   ```
   sessions/extras/archive-sessions.sh /Volumes/MyDrive/claude-sessions
   ```

   It only adds and updates, never deletes, and skips the run when the drive is
   not plugged in. On macOS, [`sessions/extras/claude-session-archive.plist`](sessions/extras/claude-session-archive.plist)
   runs it daily: fill in the two paths and follow the comment at its top. The
   first run may ask whether `bash` may access a removable volume.

2. Point the mod at it: in `/config`, set **sessions → Archive folder** to
   `/Volumes/MyDrive/claude-sessions/projects`.

Don't put the archive in a git repository you push: transcripts hold whatever
the sessions saw, file contents and command output included.

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
