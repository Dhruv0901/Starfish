# Current project step

Milestone: Step 1, rough description to interpretation and ranked suggestions as JSON.
Requirements: docs/REQUIREMENTS.md.

**Status: Step 1 closed by Dhruv on 18 November 2026.** No Step 2 work has started;
the next feature is Dhruv's to choose.

Known limitations carried forward (accepted at close):

- Product names are model-written and unverified. The live run showed one mislabelled
  product (Favourites "bar") and one uncertain product (Milo bar).
- Soft constraints such as "not too heavy" are only partly honoured.
- Live behaviour was checked with one request on `claude-haiku-5-5` only.
- The folder is not under version control yet.

## Done

- **1A (offline harness):** CLI, request validation, canned mock, strict model-output
  validation, public envelope, metadata trace and offline tests.
- **1B (live adapter):** an Anthropic Messages API adapter behind the same `Provider`
  protocol. It uses max_retries=0, the 30 s / 2048-token defaults and
  `output_config.format` with the model schema. SDK errors map to UPSTREAM_ERROR with
  status-based `retryable`. It is tested through a fake SDK client and through the real
  SDK on an in-memory transport.
- **Restructure (18 November 2026):** removed the demo catalogue. The model now writes
  each product's name, description and reason, and responses carry
  `product_source: "model_suggestion"`. Details are below.

### Restructure changes

- Deleted data/demo-catalogue.json, src/shopping_assistant/catalogue.py and evals/. The
  eval cases now live inline in tests/test_harness.py.
- Merged STEP_01_REQUIREMENTS, HARNESS, ACCEPTANCE and SOURCES into docs/REQUIREMENTS.md.
  README.md is now a short project guide.
- Schemas: products are `{name, description, reason}` from the model, and
  `{rank, name, description, reason}` in the public response.
  catalogue_mode, catalogue_version and CATALOGUE_ERROR are gone.
- Prompt `step-01-v2` sends only the request. (Since replaced by v3, below.)

### Branded product names (prompt step-01-v3)

- Product `name` is now a shelf-style display name (brand, product and variant, such as
  "Arnott's Tim Tam Double Coat"), never a bare category. There is no pack size, price
  or claims in the name. The prompt tells the model to prefer well-known products and,
  if unsure a variant exists, to fall back to the brand's core product.
- The schema and validation are unchanged: name is 1 to 120 characters, and duplicate
  names are rejected. The mock examples now use branded names.
- This is prompt shaping, not model training. A live run is needed to see whether the
  model follows it; nothing verifies that a named product is real.
- Trace: dropped catalogue_version and catalogue_sha256.
- AGENTS.md and CLAUDE.md no longer mention the catalogue or the fixed 1A start.

### Evidence

- `.venv\Scripts\python -m pytest`: 89 passed, offline, with no key. The count went down from 93
  because the catalogue tests were removed; new tests cover name/description length and
  duplicate names.
- The mock CLI on examples/request.json matches examples/public-response.json, apart from request_id.
- One live call has been made; see the next section.

## Live smoke run (18 November 2026, requested by Dhruv)

Command (one live call):

```bash
.venv\Scripts\python -m shopping_assistant --prompt "Something chocolatey for an afternoon snack, not too heavy" --top-n 5 --mode live
```

- Result: status ok, exit 0, requested_n 5, returned_n 5, attempt_count 1. The public
  schema and local checks passed.
- Model `claude-haiku-5-5` (from .env), 1324 input / 548 output tokens, 4531 ms,
  request ID `req_011ChAQPhxF3q31XDMbk7UGj`, prompt `step-01-v3`.
- Names returned: Cadbury Favourites Chocolate Bar; Arnott's Tim Tam Original; Cadbury
  Dairy Milk Chocolate Bar; Lindt Lindor Milk Chocolate Truffles; Nestlé Milo Chocolate Bar.

Review notes from Claude Code, still to be confirmed by Dhruv:

- All five names are branded and display-ready, which is the goal of v3.
- "Cadbury Favourites Chocolate Bar" mislabels a mixed box as a bar; the description
  contradicts the name.
- Whether "Nestlé Milo Chocolate Bar" and its "light, crisp" description are accurate
  is uncertain. Nothing verifies products, as expected without a data source.
- Relevance is partial: truffles and a Dairy Milk block are not obviously "not too heavy".

Dhruv reviewed this run and closed Step 1 with the notes above as known limitations.

## Next (only when requested)

Dhruv chooses the Step 2 feature. Open candidates from Step 1: name accuracy and
constraint-following, possibly backed by a real product data source.
