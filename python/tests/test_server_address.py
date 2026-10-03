import http.server
import threading

import pytest

import prem
from prem._backends import check_server_url


def test_plain_http_to_another_computer_is_refused():
    with pytest.raises(ValueError, match="https://"):
        prem.connect("http://prem.example.org", token="t")
    with pytest.raises(ValueError, match="https://"):
        check_server_url("http://10.0.0.5:4747")


def test_https_and_this_computer_are_allowed():
    for url in ("https://prem.example.org", "http://localhost:4747", "http://127.0.0.1:4747", "http://[::1]:4747"):
        check_server_url(url)


def test_insecure_allows_http_with_a_warning():
    with pytest.warns(UserWarning, match="unencrypted"):
        check_server_url("http://10.0.0.5:4747", insecure=True)


def test_not_a_server_address():
    with pytest.raises(ValueError, match="isn't a server address"):
        check_server_url("ftp://prem.example.org")


class _Redirect(http.server.BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):  # noqa: N802
        _Redirect.seen.append((self.path, self.headers.get("Authorization")))
        if self.path.startswith("/api/info"):
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/elsewhere")
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"name": "x"}')

    def log_message(self, *args):
        pass


def test_redirects_are_not_followed_so_the_token_stays_put():
    server = http.server.HTTPServer(("127.0.0.1", 0), _Redirect)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with pytest.raises(prem.PremError, match="redirected"):
            prem.connect(f"http://127.0.0.1:{server.server_port}", token="secret")
        assert [p for p, _ in _Redirect.seen] == ["/api/info"]
    finally:
        server.shutdown()
