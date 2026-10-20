// The session index is built by a Python script on the host: the mod's own
// environment has no filesystem walk, and the transcripts total hundreds of
// megabytes, so the script caches per file on (size, mtime) and only re-reads
// the ones that changed.
export const INDEXER = String.raw`
import json, os, sys

live_root, archive_root, cache_path = sys.argv[1], sys.argv[2], sys.argv[3]
archive_root = os.path.expanduser(archive_root) if archive_root else ''

try:
    with open(cache_path) as f:
        cache = json.load(f)
except Exception:
    cache = {}

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                return block.get('text', '')
    return ''

def is_prompt(row):
    if row.get('type') != 'user' or row.get('isMeta') or row.get('isSidechain'):
        return False
    msg = row.get('message') or {}
    content = msg.get('content')
    if isinstance(content, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in content):
        return False
    text = text_of(content).strip()
    return bool(text) and not text.startswith('<')

def read_session(path):
    cwd, title, custom, first, prompts = None, None, None, None, 0
    with open(path, errors='replace') as f:
        for line in f:
            if '"type"' not in line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            kind = row.get('type')
            if kind == 'custom-title':
                custom = row.get('customTitle') or custom
            elif kind == 'ai-title':
                title = row.get('aiTitle') or row.get('title') or title
            elif kind == 'summary':
                title = title or row.get('summary')
            if cwd is None and row.get('cwd'):
                cwd = row['cwd']
            if is_prompt(row):
                prompts += 1
                if first is None:
                    first = text_of(row['message']['content']).strip()
    return {'cwd': cwd, 'title': custom or title, 'first': (first or '')[:300], 'prompts': prompts}

sessions = {}
fresh_cache = {}
for source, root in (('live', live_root), ('archive', archive_root)):
    if not os.path.isdir(root):
        continue
    for project in os.listdir(root):
        folder = os.path.join(root, project)
        if not os.path.isdir(folder):
            continue
        for name in os.listdir(folder):
            if not name.endswith('.jsonl'):
                continue
            path = os.path.join(folder, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            sid = name[:-6]
            if sid in sessions:
                sessions[sid]['inArchive'] = sessions[sid]['inArchive'] or source == 'archive'
                continue
            stamp = [st.st_size, int(st.st_mtime)]
            hit = cache.get(path)
            info = hit['info'] if hit and hit.get('stamp') == stamp else read_session(path)
            fresh_cache[path] = {'stamp': stamp, 'info': info}
            if info['prompts'] == 0:
                continue
            sessions[sid] = dict(info, id=sid, project=project, path=path,
                                 mtime=int(st.st_mtime), size=st.st_size,
                                 isLive=source == 'live', inArchive=source == 'archive')

try:
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path + '.tmp', 'w') as f:
        json.dump(fresh_cache, f)
    os.replace(cache_path + '.tmp', cache_path)
except Exception:
    pass

out = sorted(sessions.values(), key=lambda s: s['mtime'], reverse=True)
json.dump({'sessions': out, 'archiveMounted': os.path.isdir(archive_root)}, sys.stdout)
`
