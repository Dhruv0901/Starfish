"""Thin HTTP wrapper: POST /recommendations runs the same harness as the CLI and returns its envelope.

python -m shopping_assistant.server [--host 127.0.0.1] [--port 8000] [--mode mock|live] [--trace-file PATH]
Serve plain HTTP behind an HTTPS proxy or host; the Anthropic key stays in this process's environment.
GET /healthz answers without touching the provider. If STARFISH_TESTER_CODE is set (required in live mode),
POST /recommendations needs a matching X-Starfish-Tester-Code header before the harness runs.
"""

import argparse
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dotenv import load_dotenv

from . import ROOT
from .errors import AppError
from .harness import error_response, run
from .provider import CannedMockProvider, Provider, make_live_provider
from .trace import TRACE_PATH
from .validation import strict_loads

MAX_BODY_BYTES = 16 * 1024
CODE_HEADER = "X-Starfish-Tester-Code"
_STATUS = {"INVALID_INPUT": 400, "UNAUTHORIZED": 401, "UPSTREAM_ERROR": 502, "MODEL_REFUSAL": 422,
           "INCOMPLETE_OUTPUT": 502, "INVALID_MODEL_OUTPUT": 502}


def make_handler(provider: Provider, mode: str, trace_path: Path = TRACE_PATH, tester_code: str | None = None):
    expected = tester_code.encode("utf-8") if tester_code else None

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/healthz":
                return self._send(200, {"status": "ok", "mode": mode})
            self._send(404, {"detail": "Not found."})

        def do_POST(self):
            if self.path != "/recommendations":
                return self._send(404, {"detail": "Not found."})
            given = (self.headers.get(CODE_HEADER) or "").strip().encode("utf-8")
            if expected and not hmac.compare_digest(given, expected):
                envelope = error_response(AppError("UNAUTHORIZED", "This tester code is missing or no longer valid."),
                                          mode, trace_path=trace_path)
                return self._send(401, envelope)
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if not 0 < length <= MAX_BODY_BYTES:
                envelope = error_response(AppError("INVALID_INPUT", "Send a JSON body of at most 16 KB."),
                                          mode, trace_path=trace_path)
            else:
                try:
                    raw = strict_loads(self.rfile.read(length).decode("utf-8"))
                except (UnicodeDecodeError, ValueError):
                    envelope = error_response(AppError("INVALID_INPUT", "The request body was not strict JSON."),
                                              mode, trace_path=trace_path)
                else:
                    envelope = run(raw, provider, mode, trace_path=trace_path)
            status = 200 if envelope["status"] == "ok" else _STATUS.get(envelope["error"]["code"], 500)
            self._send(status, envelope)

        def _send(self, status: int, body: dict):
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format, *args):  # keep shopping text out of server logs
            pass

    return Handler


def main(argv=None) -> None:
    load_dotenv(ROOT / ".env", override=False)
    parser = argparse.ArgumentParser(prog="python -m shopping_assistant.server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--mode", choices=["mock", "live"], default=os.environ.get("PROVIDER_MODE") or "mock")
    parser.add_argument("--trace-file", type=Path, default=TRACE_PATH, help="e.g. /dev/stdout on a host with logs")
    args = parser.parse_args(argv)
    tester_code = os.environ.get("STARFISH_TESTER_CODE", "").strip() or None
    if args.mode == "live" and not tester_code:
        raise AppError("CONFIG_ERROR", "Live mode needs STARFISH_TESTER_CODE so the paid route is not open.")
    # Fails fast with CONFIG_ERROR if live mode has no key or model.
    provider = CannedMockProvider() if args.mode == "mock" else make_live_provider(os.environ)
    handler = make_handler(provider, args.mode, trace_path=args.trace_file, tester_code=tester_code)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving POST http://{args.host}:{args.port}/recommendations ({args.mode} mode)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
