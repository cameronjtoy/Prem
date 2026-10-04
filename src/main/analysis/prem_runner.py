"""Runs the Python cells of one Prem note.

Prem starts one of these per open note and sends it cells over stdin, one JSON object per line:

    {"id": "1", "code": "print(2 + 2)", "cwd": "/vault/Notebook", "root": "/vault"}

and reads one JSON object per line back:

    {"id": "1", "ok": true, "outputs": [...], "inputs": [...], "duration": 0.01}

Cells share one namespace, so variables carry from one cell to the next, and the value of a cell's last
expression is shown, as in Jupyter. Only the standard library is used; matplotlib figures and pandas tables
are picked up when those packages are installed.

Anything the code prints, even from C extensions writing straight to the file descriptor, goes to the
cell's output or to stderr, never into the replies.
"""

import ast
import base64
import hashlib
import io
import json
import linecache
import os
import signal
import sys
import time
import traceback

MAX_TEXT = 20_000
MAX_TABLE_ROWS = 1_000
MAX_INPUTS = 200
CELL = "<cell>"

# Replies go to a private copy of stdout; file descriptor 1 is pointed at stderr so stray writes can't
# break the protocol.
_replies = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)

_namespace = {"__name__": "__main__"}
_recording = None  # set of absolute paths opened for reading while a cell runs
_running = False


def _interrupt(signum, frame):
    # Stop means "stop this cell". Between cells there's nothing to stop, so the runner keeps waiting.
    if _running:
        raise KeyboardInterrupt


signal.signal(signal.SIGINT, _interrupt)


def _audit(event, args):
    if event != "open" or _recording is None or not args:
        return
    path, mode = args[0], args[1] if len(args) > 1 else "r"
    if not isinstance(path, (str, bytes, os.PathLike)):
        return
    if mode is not None and any(m in str(mode) for m in "wax+"):
        return
    try:
        _recording.add(os.path.abspath(os.fsdecode(path)))
    except Exception:
        pass


sys.addaudithook(_audit)


def _cut(text):
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT] + f"\n… {len(text) - MAX_TEXT} more characters"


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _inputs(opened, root):
    found = []
    # Compare real paths: the vault may be reached through a symlink (macOS's /var is /private/var), while
    # Python reports files by where they really are.
    root = os.path.realpath(root)
    for path in sorted({os.path.realpath(p) for p in opened}):
        try:
            if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
                continue
        except ValueError:  # different drives on Windows
            continue
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        found.append({"path": rel, "sha256": _sha256(path)})
        if len(found) >= MAX_INPUTS:
            break
    return found


def _table(value):
    """A pandas DataFrame or Series as CSV, or None for anything else."""
    pandas = sys.modules.get("pandas")
    if pandas is None:
        return None
    if isinstance(value, pandas.Series):
        value = value.to_frame()
    if not isinstance(value, pandas.DataFrame):
        return None
    rows, columns = value.shape
    return {
        "kind": "table",
        "csv": value.head(MAX_TABLE_ROWS).to_csv(),
        "rows": int(rows),
        "columns": int(columns),
        "truncated": rows > MAX_TABLE_ROWS,
    }


def _figures():
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return []
    images = []
    for number in pyplot.get_fignums():
        buffer = io.BytesIO()
        pyplot.figure(number).savefig(buffer, format="png", dpi=110, bbox_inches="tight")
        images.append({"kind": "image", "mime": "image/png", "data": base64.b64encode(buffer.getvalue()).decode()})
    pyplot.close("all")
    return images


def _error(exc):
    # Only the frames from the cell itself: the runner's own frames would just be noise.
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == CELL]
    lines = traceback.format_list(frames) + traceback.format_exception_only(type(exc), exc)
    return {
        "kind": "error",
        "name": type(exc).__name__,
        "message": str(exc),
        "traceback": _cut("Traceback (most recent call last):\n" + "".join(lines) if frames else "".join(lines)),
    }


def run(request):
    global _recording, _running
    code = request.get("code", "")
    cwd = request.get("cwd") or os.getcwd()
    root = request.get("root") or cwd
    outputs = []
    stdout, stderr = io.StringIO(), io.StringIO()
    started = time.monotonic()
    ok = True
    linecache.cache[CELL] = (len(code), None, code.splitlines(True), CELL)
    previous = sys.stdout, sys.stderr, os.getcwd()
    try:
        os.chdir(cwd)
        tree = ast.parse(code, CELL, "exec")
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        sys.stdout, sys.stderr = stdout, stderr
        _recording = set()
        _running = True
        exec(compile(tree, CELL, "exec"), _namespace)
        value = eval(compile(ast.Expression(last.value), CELL, "eval"), _namespace) if last else None
    except KeyboardInterrupt:
        ok = False
        value = None
        outputs.append({"kind": "error", "name": "Stopped", "message": "Stopped before it finished.", "traceback": ""})
    except BaseException as exc:  # noqa: BLE001 — a cell's SystemExit or anything else is reported, not fatal
        ok = False
        value = None
        outputs.append(_error(exc))
    finally:
        _running = False
        opened, _recording = _recording or set(), None
        sys.stdout, sys.stderr = previous[0], previous[1]
        os.chdir(previous[2])

    if stdout.getvalue():
        outputs.insert(0, {"kind": "text", "stream": "stdout", "text": _cut(stdout.getvalue())})
    if stderr.getvalue():
        outputs.insert(1 if stdout.getvalue() else 0, {"kind": "text", "stream": "stderr", "text": _cut(stderr.getvalue())})
    if ok and value is not None:
        try:
            outputs.append(_table(value) or {"kind": "result", "text": _cut(repr(value))})
        except Exception as exc:  # a broken __repr__
            outputs.append(_error(exc))
    try:
        outputs.extend(_figures())
    except Exception as exc:
        outputs.append(_error(exc))

    return {
        "id": request.get("id"),
        "ok": ok,
        "outputs": outputs,
        "inputs": _inputs(opened, root),
        "duration": round(time.monotonic() - started, 3),
    }


def main():
    _replies.write(json.dumps({"ready": True, "python": sys.version.split()[0], "executable": sys.executable}) + "\n")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        try:
            reply = run(request)
        except KeyboardInterrupt:
            reply = {"id": request.get("id"), "ok": False, "outputs": [], "inputs": [], "duration": 0}
        _replies.write(json.dumps(reply) + "\n")


if __name__ == "__main__":
    main()
