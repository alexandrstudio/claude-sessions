// Host-side scripts for the archive: the mod's environment has no file
// copies, so these run under python3 like the indexer. Each prints one JSON
// line on success and exits non-zero with a one-line reason otherwise.

// Copies every file under ~/.claude/projects whose archive copy is missing or
// differs in size or mtime. Never deletes from the archive.
export const ARCHIVER = String.raw`
import json, os, shutil, sys
live_root, archive_root = sys.argv[1], os.path.expanduser(sys.argv[2])
# An archive on an external drive waits for the drive; any other folder is
# created on first use.
parts = os.path.abspath(archive_root).split('/')
if parts[1:2] == ['Volumes'] and not os.path.isdir('/'.join(parts[:3])):
    sys.exit('/'.join(parts[:3]) + ' is not mounted')
os.makedirs(archive_root, exist_ok=True)
copied = total = 0
for folder, _dirs, files in os.walk(live_root):
    rel = os.path.relpath(folder, live_root)
    for name in files:
        total += 1
        src = os.path.join(folder, name)
        dest = os.path.join(archive_root, rel, name)
        try:
            st = os.stat(src)
            dt = os.stat(dest) if os.path.exists(dest) else None
            if dt and dt.st_size == st.st_size and int(dt.st_mtime) == int(st.st_mtime):
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(src, dest)
            copied += 1
        except OSError:
            continue
json.dump({'copied': copied, 'files': total}, sys.stdout)
`

// Removes a session's copy in ~/.claude/projects, but only when every one of
// its files has an identical copy in the archive.
export const MOVER = String.raw`
import json, os, shutil, sys
live_path, archive_root, project = sys.argv[1], os.path.expanduser(sys.argv[2]), sys.argv[3]
archive_dir = os.path.join(archive_root, project)

def same(src, dest):
    if not os.path.exists(dest):
        return False
    a, b = os.stat(src), os.stat(dest)
    return a.st_size == b.st_size and int(a.st_mtime) == int(b.st_mtime)

checks = [(live_path, os.path.join(archive_dir, os.path.basename(live_path)))]
side = live_path[:-6]
if os.path.isdir(side):
    for folder, _dirs, files in os.walk(side):
        rel = os.path.relpath(folder, os.path.dirname(side))
        checks += [(os.path.join(folder, n), os.path.join(archive_dir, rel, n)) for n in files]
stale = [src for src, dest in checks if not same(src, dest)]
if stale:
    sys.exit('the archive copy is not up to date; archive first')
os.remove(live_path)
if os.path.isdir(side):
    shutil.rmtree(side)
json.dump({'removed': len(checks)}, sys.stdout)
`

// Copies an archived transcript (and its subagent folder, when there is one)
// back where claude -r looks for it.
export const RESTORE = String.raw`
import json, os, shutil, sys
src, dest_dir = sys.argv[1], sys.argv[2]
os.makedirs(dest_dir, exist_ok=True)
dest = os.path.join(dest_dir, os.path.basename(src))
if os.path.exists(dest):
    sys.exit('already restored')
shutil.copy2(src, dest)
side = src[:-6]
if os.path.isdir(side):
    shutil.copytree(side, os.path.join(dest_dir, os.path.basename(side)), dirs_exist_ok=True)
json.dump({'restored': True}, sys.stdout)
`
