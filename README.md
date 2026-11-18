# Shopping assistant (Step 1)

A local Python CLI that turns a rough shopping description into a short interpretation
and up to N ranked product suggestions, as validated JSON. One Claude API call per live
run. Each suggestion has a specific, shelf-style product name (brand, product and
variant), but it is written by the model and unverified: there are no prices, stock or
store data.

Requirements: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). Progress: [docs/CURRENT_STEP.md](docs/CURRENT_STEP.md).

## Setup (Windows)

```bash
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pip install -e . --no-deps
```

For live mode, copy `.env.example` to `.env`, then set `ANTHROPIC_API_KEY` and
`ANTHROPIC_MODEL`. Never commit `.env`.

## Run

```bash
.venv\Scripts\python -m pytest
.venv\Scripts\python -m shopping_assistant --request examples/request.json --mode mock
.venv\Scripts\python -m shopping_assistant --prompt "Quick healthy lunch" --top-n 4 --mode live
```

- `--request FILE` and `--prompt TEXT` are mutually exclusive. `--top-n` only goes with `--prompt`.
- `--mode` overrides `PROVIDER_MODE`. The default is mock, which only answers examples/request.json.
- Every run prints one JSON envelope and appends metadata to `traces/runs.jsonl`.
- Exit codes: 0 for ok, 2 for input or config errors, 1 for any other error.

## Layout

| Path | Role |
| --- | --- |
| src/shopping_assistant/__main__.py | CLI and exit codes |
| src/shopping_assistant/harness.py | Fixed run sequence, envelopes, trace record |
| src/shopping_assistant/provider.py | Provider protocol, canned mock, Anthropic adapter |
| src/shopping_assistant/validation.py | Strict JSON, schema and rule checks |
| src/shopping_assistant/trace.py | Metadata JSONL |
| prompts/ | Runtime system prompt sent to the model |
| schemas/ | Request, model-output and public-response contracts |
| examples/ | Mock request/output and sample envelopes |
| tests/ | Offline tests (network blocked) |
| AGENTS.md, CLAUDE.md | Instructions for the coding assistant, never sent to the model |
