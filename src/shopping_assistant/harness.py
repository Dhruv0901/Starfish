"""The fixed Step 1 sequence: validate, assemble, invoke once, validate, rank, serialize, trace."""

import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import ROOT
from .errors import AppError
from .provider import Provider
from .trace import TRACE_PATH, append_trace
from .validation import MODEL_SCHEMA, normalize_request, validate_model_output, validate_public

PROMPT_PATH = ROOT / "prompts" / "recommend-products.system.md"
PROMPT_VERSION = "step-02-v1"
SCHEMA_VERSION = "1.0"

_STOP_REASON_ERRORS = {
    "refusal": ("MODEL_REFUSAL", "The model declined this request."),
    "max_tokens": ("INCOMPLETE_OUTPUT", "The model reached its output limit before finishing."),
}


def _new_meta(provider_mode: str | None) -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "provider_mode": provider_mode,
        "status": None,
        "error_code": None,
        "requested_n": None,
        "returned_n": None,
        "attempt_count": 0,
        "model_id": None,
        "provider_request_id": None,
        "prompt_version": PROMPT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "elapsed_ms": None,
        "input_tokens": None,
        "output_tokens": None,
    }


def _error_envelope(request_id: str, error: AppError) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "request_id": request_id,
        "status": "error",
        "data": None,
        "error": {"code": error.code, "message": error.message, "retryable": error.retryable},
    }


def _finish(envelope: dict, meta: dict, started: float, trace_path: Path) -> dict:
    meta["status"] = envelope["status"]
    if envelope["error"]:
        meta["error_code"] = envelope["error"]["code"]
    else:
        meta["returned_n"] = envelope["data"]["returned_n"]
    meta["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    append_trace(meta, trace_path)
    return envelope


def error_response(error: AppError, provider_mode: str | None = None, trace_path: Path = TRACE_PATH) -> dict:
    """For failures found before the harness can run (e.g. bad CLI arguments); still traced."""
    started = time.monotonic()
    meta = _new_meta(provider_mode)
    return _finish(_error_envelope(meta["request_id"], error), meta, started, trace_path)


def run(raw_request, provider: Provider, provider_mode: str, *, trace_path: Path = TRACE_PATH) -> dict:
    started = time.monotonic()
    meta = _new_meta(provider_mode)
    try:
        request = normalize_request(raw_request)
        meta["requested_n"] = request["top_n"]

        # The shopping text travels as data in the user message, never in the system prompt.
        system_prompt = PROMPT_PATH.read_text(encoding="utf-8")
        user_payload = json.dumps({"request": request}, ensure_ascii=False)

        meta["attempt_count"] = 1
        result = provider.generate(system_prompt, user_payload, MODEL_SCHEMA)
        meta.update(model_id=result.model_id, provider_request_id=result.provider_request_id,
                    input_tokens=result.input_tokens, output_tokens=result.output_tokens)

        if result.stop_reason != "end_turn":
            raise AppError(*_STOP_REASON_ERRORS.get(
                result.stop_reason, ("INVALID_MODEL_OUTPUT", "The model stopped unexpectedly.")))

        output = validate_model_output(result.text, request["top_n"])
        # Keep the model's order; ranks and counts come from Python.
        products = [{"rank": rank, **item} for rank, item in enumerate(output["products"], start=1)]
        envelope = {
            "schema_version": SCHEMA_VERSION,
            "request_id": meta["request_id"],
            "status": "ok",
            "data": {
                "interpreted_description": output["interpreted_description"],
                "assumptions": output["assumptions"],
                "requested_n": request["top_n"],
                "returned_n": len(products),
                "provider_mode": provider_mode,
                "product_source": "model_suggestion",
                "products": products,
                "shortfall_reason": output["shortfall_reason"],
            },
            "error": None,
        }
        validate_public(envelope, request["top_n"])
    except AppError as exc:
        envelope = _error_envelope(meta["request_id"], exc)
    except Exception:
        envelope = _error_envelope(meta["request_id"], AppError("INTERNAL_ERROR", "Unexpected application error."))
    return _finish(envelope, meta, started, trace_path)
