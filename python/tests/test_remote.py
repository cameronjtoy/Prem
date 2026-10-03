"""Against a real Prem team server (``npm run server:build`` first): permissions, history and signing."""

import json
import re
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest

import prem

from .conftest import REPO

SERVER = REPO / "out" / "server" / "index.js"
pytestmark = pytest.mark.skipif(
    not SERVER.exists() or not shutil.which("node"),
    reason="needs Node and the built server (npm run server:build)",
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    folder = tmp_path_factory.mktemp("lab")
    config = folder / "prem-server.json"
    port = _free_port()
    out = subprocess.run(
        ["node", str(SERVER), "init", "--config", str(config), "--pi", "pat", "--members", "alice,bob",
         "--port", str(port)],
        check=True, capture_output=True, text=True,
    ).stdout
    tokens = dict(re.findall(r"^ {2}(\S+)\s+(prem_\S+)$", out, re.M))
    proc = subprocess.Popen(["node", str(SERVER), "--config", str(config)], stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(url + "/api/health", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        raise RuntimeError("the Prem server didn't start")
    yield url, tokens
    proc.kill()


def _call(url, token, method, route, body=None):
    req = urllib.request.Request(url + route, method=method,
                                 data=None if body is None else json.dumps(body).encode())
    req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read() or b"null")


NOTE = "Notebooks/alice/Gel run.md"


def test_a_member_writes_to_their_notebook_and_history_names_them(server):
    url, tokens = server
    _call(url, tokens["alice"], "PUT", "/api/file?path=" + urllib.request.quote(NOTE),
          {"content": "# Gel run\n\nLoaded 5 µL per lane.\n", "createOnly": True})

    vault = prem.connect(url, token=tokens["alice"])
    entry = vault.entry("Gel run")
    assert entry.path == NOTE
    entry.record("Bands", 3)
    path = entry.attach(b"gel image", name="gel.png")
    assert path == "Notebooks/alice/attachments/gel.png"
    assert entry.read_file("attachments/gel.png") == b"gel image"
    assert "| Bands | 3 |" in entry.text
    assert "![gel.png](attachments/gel.png)" in entry.text

    history = _call(url, tokens["alice"], "GET", "/api/history?path=" + urllib.request.quote(NOTE))
    assert [e["author"] for e in history][-2:] == ["alice", "alice"]


def test_someone_without_write_access_is_refused(server):
    url, tokens = server
    entry = prem.connect(url, token=tokens["bob"]).entry(NOTE)
    assert "Gel run" in entry.text  # notebooks are shared for reading
    with pytest.raises(prem.ForbiddenError):
        entry.record("Bands", 4)


def test_a_signed_note_is_never_changed(server):
    url, tokens = server
    _call(url, tokens["alice"], "POST", "/api/record/sign?path=" + urllib.request.quote(NOTE), {})
    entry = prem.connect(url, token=tokens["alice"]).entry(NOTE)
    assert entry.locked
    with pytest.raises(prem.LockedError):
        entry.record("Bands", 5)


def test_a_bad_token_is_explained(server):
    url, _ = server
    with pytest.raises(prem.ForbiddenError, match="access token"):
        prem.connect(url, token="prem_not-a-real-token")
