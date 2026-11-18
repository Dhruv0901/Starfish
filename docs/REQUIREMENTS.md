# Step 1 requirements

Owner: Dhruv Mehan. Revised 18 November 2026: the demo catalogue was removed, and the model
now writes the product suggestions.

## Goal

Turn a rough shopping description into a short interpretation and up to N ranked product
suggestions, returned as validated JSON from a local Python CLI. One Claude Messages API
call per live run. Our own harness owns everything around that call.

Suggestions are model-written and unverified (`product_source: "model_suggestion"`).
Each `name` is a specific, display-ready product name (brand, product and variant, such as
"Arnott's Tim Tam Double Coat") for showing in a UI. The model is told to prefer
well-known products and not invent variants, but nothing checks that a product really
exists until a later step adds a data source. There are no prices, stock, URLs or store data.

Out of scope for Step 1: any product catalogue or real Coles data, scraping, web UI,
database, RAG, embeddings, training, accounts, carts, checkout, deployment, MCP and extra
agents. Add capabilities one step at a time, when a step needs them.

## Input

| Field | Rule |
| --- | --- |
| prompt | Required string. Trimmed, then 1 to 2000 characters. |
| top_n | Integer 1 to 10, default 5. Booleans, 3.0 and strings are rejected; never coerced. |

Unknown fields are rejected. Invalid input causes zero provider calls. The contract is
schemas/request.schema.json.

## Model output (schemas/model-output.schema.json)

`interpreted_description`, `assumptions`, `products[{name, description, reason}]` and
`shortfall_reason`. All fields are required and extra fields are rejected. The wire schema
keeps to features the API's structured outputs support. These rules are checked locally:

- interpreted_description: nonblank, at most 600 characters.
- assumptions: at most 5 entries, each nonblank and at most 160 characters.
- products: at most top_n. name is nonblank and at most 120 characters; description and
  reason are nonblank and at most 240. Names must be unique, ignoring case and outer spaces.
- shortfall_reason: nonblank, at most 240 characters when fewer than top_n products are
  returned; otherwise null.

Parsing rejects malformed JSON, duplicate keys and NaN/Infinity. Bad output is never
repaired, trimmed or deduplicated; it becomes INVALID_MODEL_OUTPUT.

## Public response (schemas/public-response.schema.json)

The envelope has `schema_version`, `request_id` (UUID), `status`, `data` and `error`.
On success, `data` holds the interpretation, assumptions, `requested_n`, `returned_n`,
`provider_mode` (mock or live), `product_source`, the ranked `products` and `shortfall_reason`.
Python sets the ranks (1..n, keeping the model's order), the counts and the labels,
and checks that returned_n equals the product count and does not exceed requested_n.
On error, data is null and error is `{code, message, retryable}`.

## Harness sequence

1. Make a UUID request_id. Parse the CLI and choose mock or live (default mock).
2. Normalize and validate the request.
3. Read prompts/recommend-products.system.md. Send the request as JSON data in the user
   message, never spliced into the system prompt.
4. Call the provider once. Only stop_reason end_turn is accepted: refusal → MODEL_REFUSAL,
   max_tokens → INCOMPLETE_OUTPUT, anything else → INVALID_MODEL_OUTPUT.
5. Strictly parse and validate the output, assign ranks, and validate the public envelope.
6. Print one JSON envelope on stdout and append one trace line.

Mock mode replays examples/model-output.json for examples/request.json only, with no
network and no key. Other mock requests return INVALID_INPUT. Live never falls back to mock.

## Live adapter

The official `anthropic` SDK (pinned). It reads ANTHROPIC_API_KEY and ANTHROPIC_MODEL from
the environment or .env; existing environment values win. It uses `max_retries=0`, a 30 s
timeout (MODEL_TIMEOUT_SECONDS) and 2048 max tokens (MODEL_MAX_OUTPUT_TOKENS), with the
model schema as `output_config.format`. There are no tools, no streaming and no second call.
Missing or invalid configuration is CONFIG_ERROR before any call.

## Errors and exit codes

| Code | Trigger | retryable | Exit |
| --- | --- | --- | --- |
| INVALID_INPUT | Bad request or arguments, or mock fixture mismatch | false | 2 |
| CONFIG_ERROR | Missing or invalid live configuration | false | 2 |
| UPSTREAM_ERROR | SDK/API failure | true for timeout, connection, 408, 409, 429, 5xx | 1 |
| MODEL_REFUSAL | stop_reason refusal | false | 1 |
| INCOMPLETE_OUTPUT | stop_reason max_tokens | false | 1 |
| INVALID_MODEL_OUTPUT | Parse, shape, count, length or unexpected stop | false | 1 |
| INTERNAL_ERROR | Unexpected application failure | false | 1 |

Messages are short and sanitized; raw provider bodies are never exposed.

## Trace (traces/runs.jsonl, one line per run)

The fields are request_id, timestamp_utc, provider_mode, status, error_code, requested_n,
returned_n, attempt_count (0 or 1), model_id, provider_request_id, prompt_version,
schema_version, elapsed_ms, input_tokens and output_tokens. Values that aren't available
are null and are never invented. The trace never holds prompts, model text, keys or
environment dumps. If the trace can't be written, a warning goes to stderr and the
response stands.

## Acceptance for Step 1

- Offline tests pass with no key or network. They cover input limits, bad model output,
  counts and shortfalls, ranks and labels, stop reasons, SDK error mapping through a fake
  client, request assembly, config errors, the trace and stdout.
- One explicitly requested live smoke run passes structural checks, and its real model ID
  and token usage are recorded.
- A human review confirms the interpretation and reasons fit the prompt. Structural
  passes and mocks cannot prove relevance.

## References

- Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Python SDK: https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python
- Claude Code project memory: https://code.claude.com/docs/en/memory
