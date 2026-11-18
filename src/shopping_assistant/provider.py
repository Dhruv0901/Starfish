"""Provider boundary: the canned mock and the Anthropic Messages API adapter share one interface."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol

import anthropic

from . import ROOT
from .errors import AppError


@dataclass(frozen=True)
class ProviderResult:
    text: str
    stop_reason: str
    provider_request_id: str | None = None
    model_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class Provider(Protocol):
    def generate(self, system_prompt: str, user_payload: str, output_schema: dict) -> ProviderResult: ...


class CannedMockProvider:
    """Replays examples/model-output.json for examples/request.json only. Makes no network calls."""

    def __init__(self, request_path: Path = ROOT / "examples" / "request.json",
                 output_path: Path = ROOT / "examples" / "model-output.json"):
        self.request_path = request_path
        self.output_path = output_path

    def generate(self, system_prompt: str, user_payload: str, output_schema: dict) -> ProviderResult:
        expected = json.loads(self.request_path.read_text(encoding="utf-8"))
        expected = {"prompt": expected["prompt"].strip(), "top_n": expected.get("top_n", 5)}
        if json.loads(user_payload)["request"] != expected:
            raise AppError("INVALID_INPUT",
                           "Mock mode only has a canned answer for examples/request.json; "
                           "use --mode live for other requests.")
        return ProviderResult(text=self.output_path.read_text(encoding="utf-8"), stop_reason="end_turn")


class AnthropicProvider:
    """One Messages API request per call. No retries, tools, streaming or repair."""

    def __init__(self, client, model_id: str, max_tokens: int):
        self.client = client
        self.model_id = model_id
        self.max_tokens = max_tokens

    def generate(self, system_prompt: str, user_payload: str, output_schema: dict) -> ProviderResult:
        try:
            response = self.client.messages.create(
                model=self.model_id,
                max_tokens=self.max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_payload}],
                output_config={"format": {"type": "json_schema", "schema": output_schema}},
            )
        except anthropic.APITimeoutError:
            raise AppError("UPSTREAM_ERROR", "The Claude API request timed out.", True) from None
        except anthropic.APIConnectionError:
            raise AppError("UPSTREAM_ERROR", "Could not connect to the Claude API.", True) from None
        except anthropic.APIStatusError as exc:
            status = exc.status_code
            retryable = status in (408, 409, 429) or status >= 500
            # Raw provider body is never exposed; status code only.
            raise AppError("UPSTREAM_ERROR", f"The Claude API returned HTTP {status}.", retryable) from None

        usage = getattr(response, "usage", None)
        return ProviderResult(
            text="".join(b.text for b in response.content if b.type == "text"),
            stop_reason=response.stop_reason,
            provider_request_id=getattr(response, "_request_id", None),
            model_id=getattr(response, "model", None) or self.model_id,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )


def make_live_provider(env: Mapping[str, str], client_factory=anthropic.Anthropic) -> AnthropicProvider:
    """Build the live adapter from configuration, or raise CONFIG_ERROR before any API call."""
    key = env.get("ANTHROPIC_API_KEY", "").strip()
    model_id = env.get("ANTHROPIC_MODEL", "").strip()
    if not key or not model_id:
        raise AppError("CONFIG_ERROR", "Live mode needs ANTHROPIC_API_KEY and ANTHROPIC_MODEL set locally.")
    try:
        timeout = float(env.get("MODEL_TIMEOUT_SECONDS") or 30)
        max_tokens = int(env.get("MODEL_MAX_OUTPUT_TOKENS") or 2048)
    except ValueError:
        raise AppError("CONFIG_ERROR", "MODEL_TIMEOUT_SECONDS and MODEL_MAX_OUTPUT_TOKENS must be numbers.") from None
    if not 0 < timeout <= 600 or max_tokens < 1:
        raise AppError("CONFIG_ERROR", "MODEL_TIMEOUT_SECONDS or MODEL_MAX_OUTPUT_TOKENS is out of range.")
    # Explicit key so an unset key is a CONFIG_ERROR, not a silent fallback to another credential source.
    client = client_factory(api_key=key, max_retries=0, timeout=timeout)
    return AnthropicProvider(client, model_id, max_tokens)
