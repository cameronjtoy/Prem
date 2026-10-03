"""Where a vault's files live: a folder on this computer, or a Prem team server.

Both offer the same few operations. Neither writes Prem's history itself: in a local vault the app records
the change as an edit made outside Prem when it sees it, and a team server records it with your name."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ._errors import ConflictError, ExistsError, ForbiddenError, LockedError, NotFoundError, PremError
from ._markdown import normalize_path

PREM_FOLDER = ".prem"


class Backend:
    name: str
    location: str

    def read(self, path: str) -> Tuple[str, str]:
        """The note's text and a version to pass back to ``write``."""
        raise NotImplementedError

    def write(self, path: str, content: str, expected_version: Optional[str]) -> None:
        raise NotImplementedError

    def write_new_binary(self, path: str, data: bytes) -> None:
        """Writes a new file; raises ``ExistsError`` if the name is taken."""
        raise NotImplementedError

    def read_binary(self, path: str) -> bytes:
        raise NotImplementedError

    def files(self) -> List[str]:
        """Every file in the vault (not folders), as vault paths."""
        raise NotImplementedError

    def locked(self, path: str) -> bool:
        raise NotImplementedError


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_locked(entries: List[Dict[str, Any]]) -> bool:
    """Whether a note's history leaves it signed: the same folding as the app's ``applyEntry``."""
    locked = False
    for e in entries:
        kind = e.get("kind")
        if kind == "signed":
            locked = True
        elif kind in ("amended", "deleted"):
            locked = False
    return locked


class LocalBackend(Backend):
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.name = self.root.name
        self.location = str(self.root)

    def _file(self, path: str) -> Path:
        rel = normalize_path(path)
        target = (self.root / rel).resolve()
        if target != self.root and self.root not in target.parents:
            raise PremError(f"{path} is outside the vault")
        return target

    def read(self, path: str) -> Tuple[str, str]:
        try:
            data = self._file(path).read_bytes()
        except FileNotFoundError:
            raise NotFoundError(f'There\'s no note "{path}" in {self.name}') from None
        return data.decode("utf-8"), _sha256(data)

    def write(self, path: str, content: str, expected_version: Optional[str]) -> None:
        if self.locked(path):
            raise LockedError(f"{path} is signed. Change it in Prem with Amend, which records why.")
        target = self._file(path)
        if expected_version is not None:
            try:
                current = _sha256(target.read_bytes())
            except FileNotFoundError:
                current = None
            if current != expected_version:
                raise ConflictError(f"{path} changed while this was writing to it. Read it again and retry.")
        target.parent.mkdir(parents=True, exist_ok=True)
        # Write next to it and swap in, so Prem (or a sync client) never sees half a note.
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".prem-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(content.encode("utf-8"))
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def write_new_binary(self, path: str, data: bytes) -> None:
        target = self._file(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(target, "xb") as f:
                f.write(data)
        except FileExistsError:
            raise ExistsError(f"{path} already exists") from None

    def read_binary(self, path: str) -> bytes:
        try:
            return self._file(path).read_bytes()
        except FileNotFoundError:
            raise NotFoundError(f'There\'s no file "{path}" in {self.name}') from None

    def files(self) -> List[str]:
        found = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            rel = Path(dirpath).relative_to(self.root).as_posix()
            for name in filenames:
                if not name.startswith("."):
                    found.append(name if rel == "." else f"{rel}/{name}")
        return sorted(found)

    def locked(self, path: str) -> bool:
        log = self.root / PREM_FOLDER / "history" / (normalize_path(path) + ".jsonl")
        try:
            lines = log.read_text("utf-8").splitlines()
        except FileNotFoundError:
            return False
        return is_locked([json.loads(line) for line in lines if line.strip()])


class RemoteBackend(Backend):
    """A Prem team server, through the same HTTP API the app uses. Permissions and history are the server's."""

    def __init__(self, url: str, token: str, timeout: float = 60):
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.location = self.url
        self.name = self._json("GET", "/api/info")["name"]

    def _request(self, method: str, route: str, query: Optional[Dict[str, str]] = None, body: Optional[bytes] = None,
                 content_type: Optional[str] = None) -> bytes:
        url = self.url + route + ("?" + urllib.parse.urlencode(query) if query else "")
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("User-Agent", "prem-notebook (Python)")
        if content_type:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return res.read()
        except urllib.error.HTTPError as err:
            raise self._error(err) from None
        except urllib.error.URLError as err:
            raise PremError(f"Couldn't reach the Prem server at {self.url}: {err.reason}") from None

    @staticmethod
    def _error(err: urllib.error.HTTPError) -> PremError:
        try:
            detail = json.loads(err.read())["error"]
            code, message = detail.get("code", ""), detail.get("message", "")
        except Exception:
            code, message = "", f"HTTP {err.code}"
        if err.code == 401:
            return ForbiddenError(f"The server didn't accept the access token: {message}")
        if err.code == 403:
            return ForbiddenError(message)
        if err.code == 404:
            return NotFoundError(message)
        if err.code == 423:
            return LockedError(message)
        if code == "EXISTS":
            return ExistsError(message)
        if err.code == 409:
            return ConflictError(message)
        return PremError(message)

    def _json(self, method: str, route: str, query: Optional[Dict[str, str]] = None, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        raw = self._request(method, route, query, data, "application/json" if data is not None else None)
        return json.loads(raw) if raw else None

    def read(self, path: str) -> Tuple[str, str]:
        record = self._json("GET", "/api/file", {"path": normalize_path(path)})
        return record["content"], record["version"]

    def write(self, path: str, content: str, expected_version: Optional[str]) -> None:
        if self.locked(path):
            raise LockedError(f"{path} is signed. Change it in Prem with Amend, which records why.")
        body: Dict[str, Any] = {"content": content}
        if expected_version is not None:
            body["expectedVersion"] = expected_version
        self._json("PUT", "/api/file", {"path": normalize_path(path)}, body)

    def write_new_binary(self, path: str, data: bytes) -> None:
        self._request("PUT", "/api/blob", {"path": normalize_path(path), "createOnly": "1"}, data,
                      "application/octet-stream")

    def read_binary(self, path: str) -> bytes:
        return self._request("GET", "/api/blob", {"path": normalize_path(path)})

    def files(self) -> List[str]:
        return sorted(e["path"] for e in self._json("GET", "/api/entries") if e["kind"] == "file")

    def locked(self, path: str) -> bool:
        try:
            return bool(self._json("GET", "/api/record", {"path": normalize_path(path)}).get("locked"))
        except NotFoundError:
            return False
