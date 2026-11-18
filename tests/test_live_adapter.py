"""Checkpoint 1B: the Anthropic adapter, exercised through a fake SDK client (A08 live config, A09)."""

import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from shopping_assistant import ROOT
from shopping_assistant.errors import AppError
from shopping_assistant.harness import run
from shopping_assistant.provider import make_live_provider
from shopping_assistant.validation import MODEL_SCHEMA, validate_public

MODEL_OUTPUT_TEXT = (ROOT / "examples" / "model-output.json").read_text(encoding="utf-8")
REQUEST = json.loads((ROOT / "examples" / "request.json").read_text(encoding="utf-8"))
ENV = {"ANTHROPIC_API_KEY": "test-key-not-real", "ANTHROPIC_MODEL": "configured-model"}
SECRET = "raw provider body detail"


class FakeMessages:
    def __init__(self, response=None, error=None):
        self.response, self.error, self.calls = response, error, []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def fake_factory(messages, seen):
    def factory(**kwargs):
        seen.append(kwargs)
        return SimpleNamespace(messages=messages)
    return factory


def response(stop_reason="end_turn", text=MODEL_OUTPUT_TEXT, usage=SimpleNamespace(input_tokens=812, output_tokens=164)):
    content = [SimpleNamespace(type="thinking", thinking="")]  # non-text blocks are ignored
    if text is not None:
        content.append(SimpleNamespace(type="text", text=text))
    return SimpleNamespace(content=content, stop_reason=stop_reason, model="configured-model",
                           _request_id="req_fake_1", usage=usage)


def live_run(tmp_path, messages, env=ENV):
    seen = []
    provider = make_live_provider(env, client_factory=fake_factory(messages, seen))
    trace = tmp_path / "runs.jsonl"
    envelope = run(REQUEST, provider, "live", trace_path=trace)
    validate_public(envelope)
    return envelope, seen, json.loads(trace.read_text(encoding="utf-8"))


def test_live_request_assembly_and_success(tmp_path):
    messages = FakeMessages(response())
    envelope, seen, record = live_run(tmp_path, messages)

    assert seen == [{"api_key": "test-key-not-real", "max_retries": 0, "timeout": 30.0}]
    assert len(messages.calls) == 1
    sent = messages.calls[0]
    assert set(sent) == {"model", "max_tokens", "system", "messages", "output_config"}  # no tools, no stream
    assert sent["model"] == "configured-model" and sent["max_tokens"] == 2048
    assert sent["system"] == (ROOT / "prompts" / "recommend-products.system.md").read_text(encoding="utf-8")
    assert sent["output_config"] == {"format": {"type": "json_schema", "schema": MODEL_SCHEMA}}
    [user] = sent["messages"]
    assert user["role"] == "user" and json.loads(user["content"]) == {"request": REQUEST}

    assert envelope["status"] == "ok"
    assert envelope["data"]["provider_mode"] == "live" and envelope["data"]["product_source"] == "model_suggestion"
    assert record["model_id"] == "configured-model" and record["provider_request_id"] == "req_fake_1"
    assert (record["input_tokens"], record["output_tokens"], record["attempt_count"]) == (812, 164, 1)
    assert "test-key-not-real" not in json.dumps(record) and REQUEST["prompt"] not in json.dumps(record)


def test_configured_timeout_and_max_tokens(tmp_path):
    messages = FakeMessages(response())
    env = ENV | {"MODEL_TIMEOUT_SECONDS": "12.5", "MODEL_MAX_OUTPUT_TOKENS": "1024"}
    _, seen, _ = live_run(tmp_path, messages, env)
    assert seen[0]["timeout"] == 12.5 and messages.calls[0]["max_tokens"] == 1024


def test_missing_usage_is_null_not_zero(tmp_path):
    _, _, record = live_run(tmp_path, FakeMessages(response(usage=None)))
    assert record["input_tokens"] is None and record["output_tokens"] is None


@pytest.mark.parametrize("env", [
    {},
    {"ANTHROPIC_API_KEY": "k"},
    {"ANTHROPIC_MODEL": "m"},
    {"ANTHROPIC_API_KEY": " ", "ANTHROPIC_MODEL": "m"},
    ENV | {"MODEL_TIMEOUT_SECONDS": "soon"},
    ENV | {"MODEL_TIMEOUT_SECONDS": "0"},
    ENV | {"MODEL_TIMEOUT_SECONDS": "nan"},
    ENV | {"MODEL_MAX_OUTPUT_TOKENS": "0"},
    ENV | {"MODEL_MAX_OUTPUT_TOKENS": "2.5"},
])
def test_invalid_live_config_makes_no_client(env):
    seen = []
    with pytest.raises(AppError) as info:
        make_live_provider(env, client_factory=fake_factory(FakeMessages(), seen))
    assert info.value.code == "CONFIG_ERROR" and seen == []


_REQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def status_error(cls, status):
    return cls(SECRET, response=httpx2.Response(status, request=_REQ), body={"error": {"message": SECRET}})


@pytest.mark.parametrize("error,retryable", [
    (status_error(anthropic.RateLimitError, 429), True),
    (anthropic.APITimeoutError(request=_REQ), True),
    (anthropic.APIConnectionError(message=SECRET, request=_REQ), True),
    (status_error(anthropic.InternalServerError, 529), True),
    (status_error(anthropic.ConflictError, 409), True),
    (status_error(anthropic.AuthenticationError, 401), False),
    (status_error(anthropic.BadRequestError, 400), False),
    (status_error(anthropic.NotFoundError, 404), False),
], ids=lambda v: type(v).__name__ if isinstance(v, Exception) else str(v))
def test_sdk_errors_map_to_upstream_error(tmp_path, error, retryable):
    messages = FakeMessages(error=error)
    envelope, _, record = live_run(tmp_path, messages)
    assert envelope["error"]["code"] == "UPSTREAM_ERROR"
    assert envelope["error"]["retryable"] is retryable
    assert len(messages.calls) == 1 and record["attempt_count"] == 1  # no second attempt
    assert SECRET not in json.dumps(envelope) and SECRET not in json.dumps(record)


@pytest.mark.parametrize("stop_reason,text,expected", [
    ("refusal", None, "MODEL_REFUSAL"),
    ("max_tokens", MODEL_OUTPUT_TEXT[:50], "INCOMPLETE_OUTPUT"),
    ("tool_use", MODEL_OUTPUT_TEXT, "INVALID_MODEL_OUTPUT"),
])
def test_live_stop_reasons(tmp_path, stop_reason, text, expected):
    messages = FakeMessages(response(stop_reason=stop_reason, text=text))
    envelope, _, _ = live_run(tmp_path, messages)
    assert envelope["error"]["code"] == expected and len(messages.calls) == 1


def test_live_output_is_still_validated_locally(tmp_path):
    bad = json.loads(MODEL_OUTPUT_TEXT)
    bad["products"][0]["name"] = "   "
    envelope, _, _ = live_run(tmp_path, FakeMessages(response(text=json.dumps(bad))))
    assert envelope["error"]["code"] == "INVALID_MODEL_OUTPUT"


def test_real_sdk_serializes_request_without_network(tmp_path):
    """The installed anthropic SDK accepts our parameters; an in-memory transport answers instead of the API."""
    captured = []

    def handler(request):
        captured.append((request.headers, json.loads(request.content)))
        return httpx2.Response(200, headers={"request-id": "req_mock_transport"}, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": "configured-model",
            "content": [{"type": "text", "text": MODEL_OUTPUT_TEXT}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 900, "output_tokens": 150},
        })

    def factory(**kwargs):
        return anthropic.Anthropic(**kwargs, http_client=anthropic.DefaultHttpxClient(
            transport=httpx2.MockTransport(handler)))

    provider = make_live_provider(ENV, client_factory=factory)
    assert provider.client.max_retries == 0 and provider.client.timeout == 30.0
    envelope = run(REQUEST, provider, "live", trace_path=tmp_path / "runs.jsonl")

    assert envelope["status"] == "ok" and len(captured) == 1
    headers, body = captured[0]
    assert headers["authorization"] == "Bearer test-key-not-real"  # SDK 2.x auth header
    assert body["output_config"] == {"format": {"type": "json_schema", "schema": MODEL_SCHEMA}}
    assert body["max_tokens"] == 2048 and "stream" not in body and "tools" not in body
    record = json.loads((tmp_path / "runs.jsonl").read_text(encoding="utf-8"))
    assert record["provider_request_id"] == "req_mock_transport" and record["input_tokens"] == 900
