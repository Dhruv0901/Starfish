"""Smoke-test a deployed API: python -m shopping_assistant.smoke https://ORIGIN [--prompt TEXT]

Reads STARFISH_TESTER_CODE from the environment or .env and never prints it. Checks /healthz, that a request
without the code is refused (no Claude call), then makes exactly one authorised live search.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

from dotenv import load_dotenv

from . import ROOT

BISCUITS = "I remember two chocolate biscuits with a cream centre, all covered in chocolate. What might they be?"


def problems(status: int, envelope: dict) -> list[str]:
    """What is wrong with an authorised live response; empty when it proves a live Claude search."""
    data = envelope.get("data") or {}
    found = []
    if status != 200 or envelope.get("status") != "ok":
        found.append(f"expected HTTP 200 ok, got {status} {envelope.get('error')}")
    if data.get("provider_mode") != "live":
        found.append(f"provider_mode is {data.get('provider_mode')!r}, not 'live'")
    products = data.get("products") or []
    if [p.get("rank") for p in products] != list(range(1, len(products) + 1)):
        found.append("products are not ranked 1..n")
    if not products and not data.get("shortfall_reason"):
        found.append("no products and no shortfall_reason")
    return found


def _call(url: str, body: dict | None = None, code: str | None = None, timeout: float = 70) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"} | ({"X-Starfish-Tester-Code": code} if code else {})
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def main(argv=None) -> int:
    load_dotenv(ROOT / ".env", override=False)
    parser = argparse.ArgumentParser(prog="python -m shopping_assistant.smoke")
    parser.add_argument("origin")
    parser.add_argument("--prompt", default=BISCUITS)
    args = parser.parse_args(argv)
    base = args.origin.rstrip("/")
    code = os.environ.get("STARFISH_TESTER_CODE", "").strip()
    if not code:
        print("Set STARFISH_TESTER_CODE in .env (the same value as on the host) first.")
        return 2

    status, body = _call(base + "/healthz")
    print(f"GET /healthz -> {status} {body}")
    status, body = _call(base + "/recommendations", {"prompt": "milk", "top_n": 6})
    print(f"POST without code -> {status} {body.get('error', {}).get('code')}")
    if status != 401:
        print("FAIL: the paid route answered without a tester code.")
        return 1

    status, envelope = _call(base + "/recommendations", {"prompt": args.prompt, "top_n": 6}, code)
    data = envelope.get("data") or {}
    print(f"POST with code -> {status} request_id={envelope.get('request_id')} provider_mode={data.get('provider_mode')}")
    for p in data.get("products") or []:
        print(f"  {p['rank']}. {p['name']} - {p['description']}")
    found = problems(status, envelope)
    for problem in found:
        print("FAIL:", problem)
    print("OK: live search verified; match request_id in the host logs." if not found else "")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
