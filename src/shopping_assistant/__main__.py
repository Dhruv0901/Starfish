"""CLI: python -m shopping_assistant (--request FILE | --prompt TEXT [--top-n N]) [--mode mock|live]"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from . import ROOT
from .errors import AppError
from .harness import error_response, run
from .provider import CannedMockProvider, make_live_provider
from .trace import TRACE_PATH
from .validation import strict_loads

_SETUP_ERRORS = {"INVALID_INPUT", "CONFIG_ERROR"}


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # one JSON envelope on stdout instead of argparse's usage text
        raise AppError("INVALID_INPUT", "Invalid arguments: use --request FILE or --prompt TEXT [--top-n N].")


def _parse(argv) -> tuple[object, str]:
    parser = _Parser(prog="python -m shopping_assistant")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--request", type=Path, help="JSON request file with prompt and optional top_n")
    source.add_argument("--prompt", help="rough shopping description")
    parser.add_argument("--top-n", type=int, help="1 to 10, default 5 (only with --prompt)")
    parser.add_argument("--mode", choices=["mock", "live"], help="overrides PROVIDER_MODE; default mock")
    args = parser.parse_args(argv)

    mode = args.mode or os.environ.get("PROVIDER_MODE") or "mock"
    if mode not in ("mock", "live"):
        raise AppError("CONFIG_ERROR", "PROVIDER_MODE must be mock or live.")

    if args.request is None:
        return {"prompt": args.prompt} | ({} if args.top_n is None else {"top_n": args.top_n}), mode
    if args.top_n is not None:
        raise AppError("INVALID_INPUT", "--top-n applies only with --prompt; put top_n in the request file.")
    try:
        return strict_loads(args.request.read_text(encoding="utf-8")), mode
    except (OSError, ValueError):
        raise AppError("INVALID_INPUT", "The request file could not be read as strict JSON.") from None


def main(argv=None, trace_path: Path = TRACE_PATH) -> int:
    load_dotenv(ROOT / ".env", override=False)  # existing process environment wins
    mode = None
    try:
        raw_request, mode = _parse(argv)
        provider = CannedMockProvider() if mode == "mock" else make_live_provider(os.environ)
    except AppError as exc:
        envelope = error_response(exc, mode, trace_path=trace_path)
    else:
        envelope = run(raw_request, provider, mode, trace_path=trace_path)

    print(json.dumps(envelope, indent=2))
    if envelope["status"] == "ok":
        return 0
    return 2 if envelope["error"]["code"] in _SETUP_ERRORS else 1


if __name__ == "__main__":
    sys.exit(main())
