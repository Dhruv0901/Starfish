import json
import sys
from pathlib import Path

from . import ROOT

TRACE_PATH = ROOT / "traces" / "runs.jsonl"


def append_trace(record: dict, path: Path = TRACE_PATH) -> None:
    """Append one metadata line. Failure is reported on stderr and never replaces the response."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except OSError as exc:
        print(f"warning: trace write failed ({type(exc).__name__})", file=sys.stderr)
