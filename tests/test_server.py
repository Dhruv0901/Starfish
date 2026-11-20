"""POST /recommendations over a real loopback socket, with the canned mock and scripted failures."""

import _socket
import json
import socket
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import pytest

from shopping_assistant import ROOT
from shopping_assistant.errors import AppError
from shopping_assistant.provider import CannedMockProvider
from shopping_assistant.server import make_handler
from shopping_assistant.validation import validate_public

REQUEST_BODY = (ROOT / "examples" / "request.json").read_bytes()
PUBLIC_EXAMPLE = json.loads((ROOT / "examples" / "public-response.json").read_text(encoding="utf-8"))


class FailingProvider:
    def __init__(self, error):
        self.error = error

    def generate(self, *args):
        raise self.error


@pytest.fixture
def serve(tmp_path, monkeypatch):
    def loopback_only(sock, address):  # conftest blocks all connects; allow just this test server
        assert address[0] == "127.0.0.1"
        return _socket.socket.connect(sock, address)
    monkeypatch.setattr(socket.socket, "connect", loopback_only)
    servers = []

    def start(provider=None, tester_code=None):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(
            provider or CannedMockProvider(), "mock", trace_path=tmp_path / "runs.jsonl", tester_code=tester_code))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)

        def post(body: bytes, path="/recommendations", headers=None, method="POST"):
            conn = HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
            conn.request(method, path, body=body, headers={"Content-Type": "application/json", **(headers or {})})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        return post

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()


def test_example_request_returns_the_mock_envelope(serve):
    status, envelope = serve()(REQUEST_BODY)
    assert status == 200
    validate_public(envelope, 3)
    assert envelope["data"] == PUBLIC_EXAMPLE["data"]
    assert [p["name"] for p in envelope["data"]["products"]][2] == "Oatly Oat Milk Barista Edition"


@pytest.mark.parametrize("body", [b"not json", b'{"prompt": "x", "top_n": 11}', b'{"prompt": "x", "prompt": "y"}'])
def test_bad_requests_return_an_error_envelope(serve, body):
    status, envelope = serve()(body)
    assert status == 400
    validate_public(envelope)
    assert envelope["error"]["code"] == "INVALID_INPUT" and envelope["error"]["retryable"] is False


def test_retryable_provider_error_is_502_with_envelope(serve):
    post = serve(FailingProvider(AppError("UPSTREAM_ERROR", "Could not connect to the Claude API.", True)))
    status, envelope = post(b'{"prompt": "Milk for my coffee", "top_n": 6}')
    assert status == 502
    validate_public(envelope)
    assert envelope["error"] == {"code": "UPSTREAM_ERROR", "message": "Could not connect to the Claude API.",
                                 "retryable": True}


def test_unknown_path_is_404(serve):
    status, body = serve()(REQUEST_BODY, path="/other")
    assert status == 404 and body == {"detail": "Not found."}


class CountingProvider(CannedMockProvider):
    def __init__(self):
        super().__init__()
        self.calls = 0

    def generate(self, *args):
        self.calls += 1
        return super().generate(*args)


@pytest.mark.parametrize("headers", [{}, {"X-Starfish-Tester-Code": "wrong"}, {"X-Starfish-Tester-Code": ""}])
def test_missing_or_wrong_tester_code_is_401_with_no_provider_call(serve, headers):
    provider = CountingProvider()
    status, envelope = serve(provider, tester_code="s3cret-code")(REQUEST_BODY, headers=headers)
    assert status == 401
    validate_public(envelope)
    assert envelope["error"]["code"] == "UNAUTHORIZED" and envelope["error"]["retryable"] is False
    assert provider.calls == 0


def test_correct_tester_code_runs_the_harness_once(serve):
    provider = CountingProvider()
    status, envelope = serve(provider, tester_code="s3cret-code")(
        REQUEST_BODY, headers={"X-Starfish-Tester-Code": "s3cret-code"})
    assert status == 200 and envelope["status"] == "ok" and provider.calls == 1


def test_healthz_makes_no_provider_call(serve):
    provider = CountingProvider()
    status, body = serve(provider, tester_code="s3cret-code")(None, path="/healthz", method="GET")
    assert status == 200 and body == {"status": "ok", "mode": "mock"} and provider.calls == 0


def test_live_server_refuses_to_start_without_a_tester_code(monkeypatch):
    from shopping_assistant import server
    monkeypatch.setattr(server, "load_dotenv", lambda *a, **k: None)
    monkeypatch.delenv("STARFISH_TESTER_CODE", raising=False)
    with pytest.raises(AppError) as exc:
        server.main(["--mode", "live", "--port", "0"])
    assert exc.value.code == "CONFIG_ERROR"
