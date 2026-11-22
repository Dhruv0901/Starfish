import json

from shopping_assistant import ROOT
from shopping_assistant.smoke import problems

MOCK = json.loads((ROOT / "examples" / "public-response.json").read_text(encoding="utf-8"))
LIVE = {**MOCK, "data": {**MOCK["data"], "provider_mode": "live"}}


def test_live_envelope_passes():
    assert problems(200, LIVE) == []


def test_mock_error_and_bad_status_fail():
    assert any("provider_mode" in p for p in problems(200, MOCK))
    assert problems(502, LIVE)
    error = json.loads((ROOT / "examples" / "error-response.json").read_text(encoding="utf-8"))
    assert problems(400, error)
