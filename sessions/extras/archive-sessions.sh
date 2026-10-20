#!/bin/bash
# Copies Claude Code session transcripts (~/.claude/projects) into an archive
# folder. Never deletes from the archive: a session Claude Code removes stays
# archived, and /sessions can restore it.
#
#   archive-sessions.sh <archive-folder>
#
# Point the mod's "Archive folder" setting at <archive-folder>/projects.
# When the archive's parent folder is missing (an external drive not plugged
# in), the run is skipped.

ARCHIVE="${1:?usage: archive-sessions.sh <archive-folder>}"
SRC="$HOME/.claude/projects/"
DEST="$ARCHIVE/projects/"
LOG="$HOME/.claude/logs/archive-sessions.log"

mkdir -p "$(dirname "$LOG")"

if [ ! -d "$(dirname "$ARCHIVE")" ]; then
  echo "$(date '+%F %T') skipped: $(dirname "$ARCHIVE") not found" >> "$LOG"
  exit 0
fi

mkdir -p "$DEST"
if /usr/bin/rsync -a "$SRC" "$DEST" 2>> "$LOG"; then
  echo "$(date '+%F %T') ok: $(find "$DEST" -name '*.jsonl' | wc -l | tr -d ' ') transcripts archived" >> "$LOG"
else
  echo "$(date '+%F %T') FAILED (rsync exit $?)" >> "$LOG"
  exit 1
fi
