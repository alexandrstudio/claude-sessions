# sessions — a Claude Code mod

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

## Install

At the prompt of a terminal session:

```
/plugin install sessions --marketplace alexandrstudio/claude-sessions
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in
every session). From a shell:

```
claude plugin install sessions --marketplace alexandrstudio/claude-sessions
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `alexandrstudio/claude-sessions`, then
Add plugin.

## Keep your sessions longer (recommended)

Claude Code deletes transcripts older than **30 days** by default, so the list
only reaches back a month. To keep them, set `cleanupPeriodDays` in
`~/.claude/settings.json`:

```json
{ "cleanupPeriodDays": 36500 }
```

Transcripts grow (roughly 0.5–1 GB a month of heavy use), so keep an eye on
`~/.claude/projects`, or archive them elsewhere as below.

## Optional: an archive folder

Keep a second copy of your sessions on another disk, and `/sessions` lists those
too, even after they are gone from `~/.claude/projects`.

1. Copy them nightly with [`extras/archive-sessions.sh`](extras/archive-sessions.sh):

   ```
   extras/archive-sessions.sh /Volumes/MyDrive/claude-sessions
   ```

   It only adds and updates, never deletes, and skips the run when the drive is
   not plugged in. On macOS, [`extras/claude-session-archive.plist`](extras/claude-session-archive.plist)
   runs it daily: fill in the two paths and follow the comment at its top. The
   first run may ask whether `bash` may access a removable volume.

2. Point the mod at it: in `/config`, set **sessions → Archive folder** to
   `/Volumes/MyDrive/claude-sessions/projects`.

Don't put the archive in a git repository you push: transcripts hold whatever
the sessions saw, file contents and command output included.

## License

MIT
