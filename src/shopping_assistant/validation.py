"""Schema and relational validation for requests, model output and public envelopes."""

import json

from jsonschema import Draft202012Validator

from . import ROOT
from .errors import AppError


def _schema(name: str) -> dict:
    return json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))


REQUEST_SCHEMA = _schema("request.schema.json")
MODEL_SCHEMA = _schema("model-output.schema.json")
PUBLIC_SCHEMA = _schema("public-response.schema.json")

_request_validator = Draft202012Validator(REQUEST_SCHEMA)
_model_validator = Draft202012Validator(MODEL_SCHEMA)
# format="uuid" is only an annotation unless a format checker is attached.
_public_validator = Draft202012Validator(PUBLIC_SCHEMA, format_checker=Draft202012Validator.FORMAT_CHECKER)


def strict_loads(text: str):
    """json.loads that rejects duplicate keys and NaN/Infinity (raises ValueError)."""

    def pairs(items):
        keys = [k for k, _ in items]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate JSON object key")
        return dict(items)

    def bad_constant(name):
        raise ValueError(f"non-finite number {name}")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=bad_constant)


def normalize_request(raw) -> dict:
    if not isinstance(raw, dict):
        raise AppError("INVALID_INPUT", "The request must be a JSON object.")
    request = dict(raw)
    if isinstance(request.get("prompt"), str):
        request["prompt"] = request["prompt"].strip()
    request.setdefault("top_n", 5)
    errors = list(_request_validator.iter_errors(request))
    # jsonschema treats 3.0 as an integer; the requirements forbid coercing it.
    if not errors and type(request["top_n"]) is int:
        return request
    if any(e.validator == "additionalProperties" for e in errors):
        message = "Unknown request field; only prompt and top_n are allowed."
    elif any(e.validator == "required" or list(e.path) == ["prompt"] for e in errors):
        message = "prompt must be text of 1 to 2000 characters after trimming."
    else:
        message = "top_n must be an integer from 1 to 10."
    raise AppError("INVALID_INPUT", message)


def _bad_text(value: str, limit: int) -> bool:
    return not value.strip() or len(value) > limit


def validate_model_output(text: str, top_n: int) -> dict:
    def fail(message):
        return AppError("INVALID_MODEL_OUTPUT", message)

    try:
        output = strict_loads(text)
    except ValueError:
        raise fail("Model output was not strict JSON.") from None
    if any(True for _ in _model_validator.iter_errors(output)):
        raise fail("Model output did not match the expected structure.")

    if _bad_text(output["interpreted_description"], 600):
        raise fail("interpreted_description was blank or longer than 600 characters.")
    assumptions = output["assumptions"]
    if len(assumptions) > 5 or any(_bad_text(a, 160) for a in assumptions):
        raise fail("assumptions must be at most 5 nonblank entries of at most 160 characters.")

    products = output["products"]
    if len(products) > top_n:
        raise fail("Model returned more products than requested.")
    if any(_bad_text(p["name"], 120) or _bad_text(p["description"], 240) or _bad_text(p["reason"], 240)
           for p in products):
        raise fail("A product name, description or reason was blank or too long.")
    names = [p["name"].strip().casefold() for p in products]
    if len(set(names)) != len(names):
        raise fail("Model returned the same product twice.")

    shortfall = output["shortfall_reason"]
    if len(products) < top_n and (shortfall is None or _bad_text(shortfall, 240)):
        raise fail("Fewer products than requested without a valid shortfall_reason.")
    if len(products) == top_n and shortfall is not None:
        raise fail("shortfall_reason must be null when exactly top_n products are returned.")
    return output


def validate_public(envelope: dict, requested_n: int | None = None) -> None:
    """Public schema (with UUID format checks) plus the relational rules the schema cannot express."""
    if any(True for _ in _public_validator.iter_errors(envelope)):
        raise AppError("INTERNAL_ERROR", "The response failed public contract validation.")
    data = envelope["data"]
    if data is None:
        return
    products = data["products"]
    if (data["returned_n"] != len(products)
            or data["returned_n"] > data["requested_n"]
            or [p["rank"] for p in products] != list(range(1, len(products) + 1))
            or (requested_n is not None and data["requested_n"] != requested_n)):
        raise AppError("INTERNAL_ERROR", "The response failed relational contract checks.")
