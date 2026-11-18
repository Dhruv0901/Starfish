# Shopping app project instructions

## Goal

Build a shopping assistant from scratch, one working feature at a time.
Step 1 converts a rough shopping description into a short interpretation and up to N
ranked product suggestions in validated JSON. We own the runtime harness and grow it
only when the current step needs a capability.

## Current scope

- Implement only the step or task Dhruv explicitly requests. Progress is in docs/CURRENT_STEP.md.
- Read docs/REQUIREMENTS.md for the current contracts and rules.
- Preserve the contracts in schemas/. If a genuine conflict is found, explain it and
  make the smallest consistent correction across the contract, examples and docs.
- Python 3.12 or later, a local CLI, the official anthropic SDK, jsonschema and pytest.
  Use python-dotenv for local .env loading; existing process environment values take
  precedence. Pin resolved dependency versions.
- There is no product catalogue in Step 1. Suggestions are model-written, with specific
  branded product names, and are labelled product_source=model_suggestion. Never present
  them as verified listings, prices or stock.
- No catalogue or real retailer data, web UI, scraping, database, RAG, embeddings,
  training, deployment, checkout, MCP setup or extra agents until a later step asks for it.

## Harness rules

- Our Python code owns input checks, context assembly, provider invocation, response
  validation, JSON serialization, error mapping and local run metadata.
- Keep the provider behind a small injectable interface. Mock and live use the same
  interface. No agent orchestration framework or open-ended agent loop.
- One live request per run. Set SDK max_retries=0; no automatic LLM repair or second call.
- Claude returns interpreted_description, assumptions, ordered products (name,
  description, reason) and shortfall_reason. Code checks count, uniqueness and lengths,
  and assigns ranks. Do not silently repair, trim or deduplicate model output.
- Local validation remains necessary even when the API constrains JSON structure.
- Do not send CLAUDE.md, AGENTS.md, source code or secrets in shopping requests.

## Delivery and verification

- Keep changes small enough for Dhruv to inspect and understand.
- Offline tests must not require an API key, network access or spend.
- A live smoke run is explicit and separate; never run it merely because a key exists.
- Do not claim mocked results prove Claude's live output quality or API compatibility.
- Keep .env and traces/ out of version control. Log metadata, not keys or raw prompts.
- Update docs/CURRENT_STEP.md after each requested task, report the checks and stop.
  Do not start the next step until Dhruv asks for it.
