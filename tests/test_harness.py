"""Offline checks for the Step 1 harness and CLI. No key, network or spend."""

import copy
import json
import uuid

import pytest

from shopping_assistant import ROOT
from shopping_assistant.__main__ import main
from shopping_assistant.errors import AppError
from shopping_assistant.harness import run
from shopping_assistant.provider import ProviderResult
from shopping_assistant.validation import validate_public

EXAMPLE_REQUEST = json.loads((ROOT / "examples" / "request.json").read_text(encoding="utf-8"))
MODEL_OUTPUT = json.loads((ROOT / "examples" / "model-output.json").read_text(encoding="utf-8"))
PUBLIC_EXAMPLE = json.loads((ROOT / "examples" / "public-response.json").read_text(encoding="utf-8"))
ERROR_EXAMPLE = json.loads((ROOT / "examples" / "error-response.json").read_text(encoding="utf-8"))
TRACE_FIELDS = {
    "request_id", "timestamp_utc", "provider_mode", "status", "error_code", "requested_n", "returned_n",
    "attempt_count", "model_id", "provider_request_id", "prompt_version", "schema_version",
    "elapsed_ms", "input_tokens", "output_tokens",
}


class ScriptedProvider:
    """Injected fake: returns fixed text and records each call."""

    def __init__(self, output=MODEL_OUTPUT, stop_reason="end_turn", error=None):
        self.text = output if isinstance(output, str) else json.dumps(output)
        self.stop_reason = stop_reason
        self.error = error
        self.calls = []

    def generate(self, system_prompt, user_payload, output_schema):
        self.calls.append({"system_prompt": system_prompt, "payload": json.loads(user_payload),
                           "schema": output_schema})
        if self.error:
            raise self.error
        return ProviderResult(text=self.text, stop_reason=self.stop_reason)


def go(tmp_path, request=EXAMPLE_REQUEST, provider=None):
    provider = provider or ScriptedProvider()
    envelope = run(request, provider, "mock", trace_path=tmp_path / "runs.jsonl")
    validate_public(envelope)  # every envelope, ok or error, must satisfy the public contract
    return envelope, provider


def code(envelope):
    return envelope["error"]["code"] if envelope["error"] else None


def output_with(**changes):
    out = copy.deepcopy(MODEL_OUTPUT)
    out.update(changes)
    return out


first = MODEL_OUTPUT["products"][0]
rest = MODEL_OUTPUT["products"][1:]


# CLI mock path end to end: stdout, exit code, labels, trace.
def test_cli_mock_example_matches_public_example(tmp_path, capsys):
    trace = tmp_path / "runs.jsonl"
    exit_code = main(["--request", str(ROOT / "examples" / "request.json"), "--mode", "mock"], trace_path=trace)
    envelope = json.loads(capsys.readouterr().out)  # exactly one JSON document on stdout

    assert exit_code == 0
    uuid.UUID(envelope["request_id"])
    assert envelope["data"] == PUBLIC_EXAMPLE["data"]

    lines = trace.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert set(record) == TRACE_FIELDS
    assert record["status"] == "ok" and record["attempt_count"] == 1 and record["returned_n"] == 3
    assert record["model_id"] is None and record["input_tokens"] is None
    assert EXAMPLE_REQUEST["prompt"] not in lines[0] and "creamy" not in lines[0].lower()


def test_cli_mock_rejects_other_requests(tmp_path, capsys):
    exit_code = main(["--prompt", "Pasta for dinner", "--mode", "mock"], trace_path=tmp_path / "t.jsonl")
    assert exit_code == 2 and code(json.loads(capsys.readouterr().out)) == "INVALID_INPUT"


def test_cli_live_mode_without_config_is_config_error(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr("shopping_assistant.__main__.load_dotenv", lambda *a, **k: None)  # ignore a real .env
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    trace = tmp_path / "t.jsonl"
    exit_code = main(["--request", str(ROOT / "examples" / "request.json"), "--mode", "live"], trace_path=trace)
    assert exit_code == 2 and code(json.loads(capsys.readouterr().out)) == "CONFIG_ERROR"
    record = json.loads(trace.read_text(encoding="utf-8"))
    assert record["provider_mode"] == "live" and record["attempt_count"] == 0


@pytest.mark.parametrize("argv", [
    [],
    ["--prompt", "x", "--request", "examples/request.json"],
    ["--prompt", "x", "--top-n", "2.5"],
    ["--request", "examples/request.json", "--top-n", "3"],
    ["--request", "does-not-exist.json"],
])
def test_cli_argument_errors_still_print_one_envelope(tmp_path, capsys, argv):
    trace = tmp_path / "t.jsonl"
    assert main(argv + ["--mode", "mock"], trace_path=trace) == 2
    envelope = json.loads(capsys.readouterr().out)
    validate_public(envelope)
    assert code(envelope) == "INVALID_INPUT"
    assert len(trace.read_text(encoding="utf-8").splitlines()) == 1


# Invalid input fails before any provider call.
@pytest.mark.parametrize("request_", [
    {"prompt": "   ", "top_n": 3},
    {"prompt": "x" * 2001, "top_n": 3},
    {"prompt": "Breakfast", "top_n": 0},
    {"prompt": "Breakfast", "top_n": 11},
    {"prompt": "Breakfast", "top_n": 2.5},
    {"prompt": "Breakfast", "top_n": 3.0},
    {"prompt": "Breakfast", "top_n": True},
    {"prompt": "Breakfast", "top_n": "3"},
    {"prompt": "Breakfast", "top_n": None},
    {"prompt": "Breakfast", "top_n": 3, "unexpected": True},
    {"prompt": 42},
    {"top_n": 3},
    ["not", "an", "object"],
])
def test_invalid_requests(tmp_path, request_):
    envelope, provider = go(tmp_path, request_)
    assert code(envelope) == "INVALID_INPUT" and provider.calls == []


def test_prompt_is_trimmed_and_2000_chars_allowed(tmp_path):
    provider = ScriptedProvider(output_with(products=[], shortfall_reason="Nothing matches."))
    envelope, _ = go(tmp_path, {"prompt": "  " + "x" * 2000 + "  ", "top_n": 3}, provider)
    assert envelope["status"] == "ok"
    assert provider.calls[0]["payload"]["request"]["prompt"] == "x" * 2000


# Default N, and the context sent to the provider.
def test_default_top_n_is_5_and_only_the_request_is_sent(tmp_path):
    provider = ScriptedProvider(output_with(shortfall_reason="Only three items suit this request."))
    envelope, _ = go(tmp_path, {"prompt": "Breakfast"}, provider)

    sent = provider.calls[0]
    assert sent["payload"] == {"request": {"prompt": "Breakfast", "top_n": 5}}
    assert sent["system_prompt"] == (ROOT / "prompts" / "recommend-products.system.md").read_text(encoding="utf-8")
    assert "Breakfast" not in sent["system_prompt"]
    assert envelope["data"]["requested_n"] == 5 and envelope["data"]["returned_n"] == 3


# Bad model output is rejected, never repaired.
@pytest.mark.parametrize("output", [
    "not json",
    '{"interpreted_description": NaN, "assumptions": [], "products": [], "shortfall_reason": "x"}',
    json.dumps(MODEL_OUTPUT)[:-1] + ', "shortfall_reason": null}',  # duplicate key
    json.dumps(MODEL_OUTPUT)[:40],  # truncated
    {k: v for k, v in MODEL_OUTPUT.items() if k != "assumptions"},
    output_with(price="4.50"),
    output_with(products=[{**first, "price": "4.50"}] + rest),
    output_with(products=[{k: v for k, v in first.items() if k != "description"}] + rest),
    output_with(interpreted_description="   "),
    output_with(interpreted_description="x" * 601),
    output_with(assumptions=["a"] * 6),
    output_with(assumptions=["x" * 161]),
    output_with(assumptions=[" "]),
    output_with(products=[{**first, "name": " "}] + rest),
    output_with(products=[{**first, "name": "x" * 121}] + rest),
    output_with(products=[{**first, "description": ""}] + rest),
    output_with(products=[{**first, "description": "x" * 241}] + rest),
    output_with(products=[{**first, "reason": ""}] + rest),
    output_with(products=[{**first, "reason": "x" * 241}] + rest),
    output_with(products=[first, {**rest[0], "name": " " + first["name"].upper()}, rest[1]]),  # duplicate name
    output_with(products=MODEL_OUTPUT["products"] + [{"name": "Bananas", "description": "Fruit.", "reason": "Extra."}]),
    output_with(products=MODEL_OUTPUT["products"][:2]),  # fewer than N, no shortfall_reason
    output_with(products=MODEL_OUTPUT["products"][:2], shortfall_reason=" "),
    output_with(products=MODEL_OUTPUT["products"][:2], shortfall_reason="x" * 241),
    output_with(shortfall_reason="Exactly N returned, so this must be null."),
    [MODEL_OUTPUT],
])
def test_invalid_model_output(tmp_path, output):
    envelope, provider = go(tmp_path, provider=ScriptedProvider(output))
    assert code(envelope) == "INVALID_MODEL_OUTPUT"
    assert len(provider.calls) == 1  # no repair or second attempt


# Shortfalls.
@pytest.mark.parametrize("products", [MODEL_OUTPUT["products"][:1], []])
def test_shortfall_with_reason_succeeds(tmp_path, products):
    out = output_with(products=products, shortfall_reason="Few items fit this request.")
    envelope, _ = go(tmp_path, provider=ScriptedProvider(out))
    assert envelope["status"] == "ok"
    assert envelope["data"]["returned_n"] == len(products)
    assert envelope["data"]["shortfall_reason"] == out["shortfall_reason"]


# Python owns ranks and labels; order follows the model; text is passed through unchanged.
def test_order_preserved_and_ranks_assigned(tmp_path):
    reordered = output_with(products=list(reversed(MODEL_OUTPUT["products"])))
    envelope, _ = go(tmp_path, provider=ScriptedProvider(reordered))
    products = envelope["data"]["products"]
    assert [{k: p[k] for k in ("name", "description", "reason")} for p in products] == reordered["products"]
    assert [p["rank"] for p in products] == [1, 2, 3]
    assert envelope["data"]["provider_mode"] == "mock"
    assert envelope["data"]["product_source"] == "model_suggestion"


# Completion checks run before parsing.
@pytest.mark.parametrize("stop_reason,expected", [
    ("refusal", "MODEL_REFUSAL"),
    ("max_tokens", "INCOMPLETE_OUTPUT"),
    ("pause_turn", "INVALID_MODEL_OUTPUT"),
])
def test_stop_reasons(tmp_path, stop_reason, expected):
    envelope, provider = go(tmp_path, provider=ScriptedProvider(stop_reason=stop_reason))
    assert code(envelope) == expected and len(provider.calls) == 1


def test_provider_errors_are_mapped(tmp_path):
    envelope, _ = go(tmp_path, provider=ScriptedProvider(error=AppError("UPSTREAM_ERROR", "Timed out.", True)))
    assert envelope["error"] == {"code": "UPSTREAM_ERROR", "message": "Timed out.", "retryable": True}
    envelope, _ = go(tmp_path, provider=ScriptedProvider(error=KeyError("secret detail")))
    assert code(envelope) == "INTERNAL_ERROR" and "secret" not in json.dumps(envelope)


# Public contract: UUID format and relational rules are actually enforced.
def test_public_examples_validate():
    validate_public(PUBLIC_EXAMPLE, 3)
    validate_public(ERROR_EXAMPLE)


@pytest.mark.parametrize("mutate", [
    lambda e: e.update(request_id="not-a-uuid"),
    lambda e: e["data"].update(returned_n=2),
    lambda e: e["data"]["products"][1].update(rank=3),
    lambda e: e["data"].update(requested_n=2),
    lambda e: e["data"].update(product_source="verified"),
    lambda e: e["data"]["products"][0].update(price="4.50"),
])
def test_public_validation_rejects(mutate):
    envelope = copy.deepcopy(PUBLIC_EXAMPLE)
    mutate(envelope)
    with pytest.raises(AppError):
        validate_public(envelope, 3)


# A trace failure is reported without replacing the response.
def test_trace_write_failure_keeps_response(tmp_path, capsys):
    blocker = tmp_path / "blocked"
    blocker.write_text("", encoding="utf-8")  # a file where a directory is needed
    envelope = run(EXAMPLE_REQUEST, ScriptedProvider(), "mock", trace_path=blocker / "runs.jsonl")
    assert envelope["status"] == "ok"
    assert "trace write failed" in capsys.readouterr().err
