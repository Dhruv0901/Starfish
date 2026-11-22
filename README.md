# Starfish shopping assistant

A Python harness (CLI and a thin HTTP endpoint) that turns a rough shopping description into a short
interpretation and up to N ranked product suggestions, as validated JSON, plus the Starfish
shopping-list app for Android and iOS in `mobile/`. One Claude API call per live run. Suggestions are
written by the model and unverified: there are no prices, stock or store data.

## Python setup (Windows)

`requirements.txt` pins the tested runtime set (Python 3.12). Put `src` on the path:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt pytest==9.2.0
$env:PYTHONPATH = "src"
```

For live mode, create `.env` with `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` (optional:
`MODEL_TIMEOUT_SECONDS`, default 30; `MODEL_MAX_OUTPUT_TOKENS`, default 2048, use 8192 with
`claude-haiku-5-5`, which thinks by default; `PROVIDER_MODE`; `STARFISH_TESTER_CODE`). Never commit `.env`.

## Run

```powershell
.venv\Scripts\python -m pytest
.venv\Scripts\python -m shopping_assistant --request examples/request.json --mode mock
.venv\Scripts\python -m shopping_assistant --prompt "Quick healthy lunch" --top-n 4 --mode live
.venv\Scripts\python -m shopping_assistant.server --host 127.0.0.1 --port 8000 --mode mock
.venv\Scripts\python -m shopping_assistant.smoke https://YOUR-API-ORIGIN   # one paid live search against a deployment
```

- `--request FILE` and `--prompt TEXT` are mutually exclusive. `--top-n` only goes with `--prompt`.
- `--mode` overrides `PROVIDER_MODE`. The default is mock, which only answers examples/request.json.
- Every run prints one JSON envelope and appends metadata to `traces/runs.jsonl`.
- Exit codes: 0 for ok, 2 for input or config errors, 1 for any other error.

### HTTP endpoint

`POST /recommendations` takes the request JSON (`{"prompt": "Milk for my coffee", "top_n": 6}`) and
returns the same public envelope as the CLI. Status is 200 for ok, 400 for `INVALID_INPUT`, 401 for
`UNAUTHORIZED`, 502 for upstream/model output errors, 422 for a refusal and 500 otherwise; the body is
always the envelope. `GET /healthz` returns `{"status": "ok", "mode": ...}` and never calls Claude.
The server is plain HTTP and keeps the Anthropic key in its own environment; deploy it behind HTTPS.
`--trace-file /dev/stdout` sends the trace lines (metadata only, no shopping text) to the host's logs.

**Tester code (private test access).** When `STARFISH_TESTER_CODE` is set, `POST /recommendations` needs
a matching `X-Starfish-Tester-Code` header. A missing or wrong code gets 401 before the harness runs, so
it makes no Claude call (`attempt_count: 0` in the trace). Live mode refuses to start without a code.
The app asks for the code on the first live search and keeps it on the device; the APK contains no code
and no key. There is still no rate limit (Step 6 guardrails), so the Anthropic workspace spend limit is
the cost ceiling. Demo builds call no server.

## Mobile app (`mobile/`)

Expo SDK 58, React Native 0.88, TypeScript, npm lockfile. Two views: the shopping list and a
full-screen search. The list is stored on the device (AsyncStorage). No accounts, sync, prices or stock.

```powershell
cd mobile
npm ci
npm test                 # list, persistence, search adapter and UI journey tests (demo and live)
npm run typecheck
npm run export:check     # Android and iOS JS bundles from the same source, into mobile/dist
npx expo start           # open in Expo Go or a dev build
```

## Deploy the API (Render)

`render.yaml` is a Render Blueprint for one Python web service, `starfish-api` (free plan, Singapore,
health check `/healthz`, model `claude-haiku-5-5`, 30 s Claude timeout, 8192 output tokens). It installs
`requirements.txt` and runs, with `PYTHONPATH=src` and the repo's `prompts/` and `schemas/` in place:

```
python -m shopping_assistant.server --host 0.0.0.0 --port $PORT --mode live --trace-file /dev/stdout
```

1. Anthropic Console (platform.claude.com), as an organization admin:
   - Settings → Workspaces → **Create workspace** → `Starfish`.
   - Open that workspace's **Limits** and set its monthly spend limit to the figure you choose. The
     organization limit at Settings → Spend limits (platform.claude.com/settings/spend-limits) always
     applies too. For scale: one biscuit search with `claude-haiku-5-5` used about 1,500 input and
     1,600 output tokens, a small fraction of a US cent.
   - Settings → API keys → **Create key**, workspace `Starfish`, name `starfish-render`. Copy it once.
2. Make a tester code on your own machine and keep it out of chat:
   `py -c "import secrets; print(secrets.token_urlsafe(9))"`. Put it in the repo's `.env` as
   `STARFISH_TESTER_CODE=...` (the smoke test reads it) and give it to testers separately.
3. Render dashboard → **New** → **Blueprint** → connect `Dhruv0901/Starfish`, pick the branch that holds
   `render.yaml`, and apply. When asked, paste `ANTHROPIC_API_KEY` and `STARFISH_TESTER_CODE` into the
   form yourself (Render keeps them as secret environment variables). Copy the service URL
   (`https://starfish-api....onrender.com`).
4. `.venv\Scripts\python -m shopping_assistant.smoke https://THAT-URL` (with `PYTHONPATH=src`): checks
   `/healthz`, that a request without the code gets 401, and makes one live search. Match its
   `request_id` in Render → `starfish-api` → **Logs**: the trace line there shows `provider_mode`,
   `attempt_count`, `model_id` and `provider_request_id` (the Anthropic request ID).

**Pause or revoke.** Render → `starfish-api` → Settings → **Suspend Web Service** stops all traffic
(Resume restarts it). To revoke testers, change `STARFISH_TESTER_CODE` under Environment and save
(Render redeploys); old codes get 401 and the app asks for the new one. To cut Claude off entirely,
disable or delete the `starfish-render` key in the Console, or lower the workspace spend limit.

The free plan spins down after 15 idle minutes and the next request waits for a cold start. The app
waits 60 s, so that first search is usually slow rather than failed. Set `plan: starter` to keep it up.

### Search source (build configuration only)

| Variable | Values | Effect |
| --- | --- | --- |
| `EXPO_PUBLIC_SEARCH_MODE` | `demo` (default) | Bundled 59-product catalogue, deterministic ranking, up to 6 results, works in airplane mode. Labelled "Demo search". |
| | `live` | `POST {EXPO_PUBLIC_API_BASE_URL}/recommendations` with `top_n: 6` and the tester code header. Accepts only HTTP 200 with a `provider_mode: "live"` envelope and shows the backend's names and descriptions as suggestions. Anything else (offline, a mock server, a provider error) is an error with Add as written and, when retryable, Retry; never demo results. Waits up to 60 s, longer than the server's 30 s Claude timeout. |
| `EXPO_PUBLIC_API_BASE_URL` | `https://…` | Required for `live`: the bare origin, no path. On the EAS worker, `app.config.js` fails a live build whose value is missing, a placeholder or not HTTPS (EAS CLI reads the config locally before it loads EAS variables, so the check runs there, not on your PC). No secrets: it ships inside the app. |

The variables are read at bundle time. Locally, set them in the shell or `mobile/.env` (see
`mobile/.env.example`). For EAS builds, the profile sets the mode and the URL comes from the EAS
environment, once per environment (`env:update` changes it later):

```powershell
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_BASE_URL --value "https://THAT-URL" --environment preview --visibility plaintext
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_BASE_URL --value "https://THAT-URL" --environment production --visibility plaintext
npx eas-cli@latest env:list --environment preview
```

### App identity

| Field | Value |
| --- | --- |
| Name | Starfish |
| Version | 0.2.6 |
| Android versionCode | 2 (bump for every Play upload; 0.2.5 (1) was the demo build and was never uploaded) |
| Android package / iOS bundle ID | `io.github.dhruv0901.starfish` (**proposed**, not yet registered anywhere; it cannot change after the first Play upload) |
| Icons | `mobile/assets/`, generated by `py -I mobile/scripts/make-icons.py mobile/assets` |

### Builds

| Profile | Artifact | Search | Use |
| --- | --- | --- | --- |
| `preview` | APK | demo | Direct install on a tester's phone |
| `production` | AAB | demo | Google Play internal testing |
| `preview-live`, `production-live` | APK, AAB | live (Claude) | Private live testing; needs `EXPO_PUBLIC_API_BASE_URL` in the EAS environment |

From a clean checkout, as the Expo account owner:

```powershell
cd mobile
npm ci
npx eas-cli@latest login
npx eas-cli@latest init                                         # once; writes the project ID into app.json, commit it
npx eas-cli@latest build --platform android --profile preview     # APK
npx eas-cli@latest build --platform android --profile production  # AAB
npx eas-cli@latest build --platform android --profile preview-live     # live APK
npx eas-cli@latest build --platform android --profile production-live  # live AAB for Play internal testing
```

EAS generates the Android upload keystore on the first build and keeps it on Expo's servers
(`npx eas-cli@latest credentials` to download a backup). Signing files, `credentials.json` and the Play
service-account key belong in `mobile/secrets/`, which Git ignores.

### Google Play internal testing

1. Play Console → Create app → "Starfish", package `io.github.dhruv0901.starfish`.
2. The first AAB must be uploaded by hand: Test and release → Internal testing → Create new release →
   upload the `production` AAB from the EAS build page, accept Play App Signing, and save.
3. Finish the dashboard tasks Play requires before a rollout (app access, ads, content rating, target
   audience, data safety, privacy policy link).
4. Internal testing → Testers: create an email list, add testers, save, then copy the "Join on the web"
   opt-in link and send it to them. Roll out the release.
5. Later releases: bump `android.versionCode`, put a Play service-account key at
   `mobile/secrets/play-service-account.json`, then
   `npx eas-cli@latest build --platform android --profile production --auto-submit`
   (submits to the internal track only).

### Step 2.5 status

| Item | State |
| --- | --- |
| EAS project | `@dhruvmehan/starfish` (ID in `mobile/app.json`); Android upload keystore generated and held by EAS |
| APK (`preview`, demo search) | Built 2026-11-20, version 0.2.5 (1): [build](https://expo.dev/accounts/dhruvmehan/projects/starfish/builds/e979d1be-c763-4b1e-8c3e-4a3431483072) · [APK](https://expo.dev/artifacts/eas/U7B6P5pGCqEce7mhQvpW337IO0Cxq3yZ76LOxrYvGnU.apk) |
| AAB (`production`, demo search) | Built 2026-11-20, version 0.2.5 (1): [build](https://expo.dev/accounts/dhruvmehan/projects/starfish/builds/ab0b0889-3cc7-4b0b-a7ab-54882497a8c0) · [AAB](https://expo.dev/artifacts/eas/XcEx3JJCzdqEd5EPwnX-DHi3QFs6BFplSclqE8LW4-Q.aab) |
| Play | Generated bundle only. Not uploaded: no draft, no release, no tester opt-in link yet. Next action is the owner's manual first upload (steps above). |

Both builds were made with `EAS_NO_VCS=1` from the uncommitted working tree; after committing, drop that variable.

### Step 2.6 status (live search)

| Item | State |
| --- | --- |
| Code | Branch `step-2.6-live-search`: tester-code gate, `/healthz`, Render Blueprint, strict live client, build-time origin check, 0.2.6 (2). Python and mobile tests, typecheck and export pass; clean-copy install verified. |
| Model | `claude-haiku-5-5`. One local live run of the biscuit prompt: 9.2 s, 1,540 in / 1,578 out tokens, `attempt_count` 1, three Tim Tam variants. |
| Hosting | Render web service `starfish-api`, origin `https://starfish-api-lvwk.onrender.com`, model `claude-haiku-5-5`. `EXPO_PUBLIC_API_BASE_URL` set to it in the EAS `preview` and `production` environments. |
| Backend smoke test | 2026-11-22: `/healthz` 200 (live); no code → 401 `UNAUTHORIZED`; with code → 200, `provider_mode` live, `request_id` `15b5bbad-8d5b-46d8-a51e-7ed88ee83ade`, three ranked Tim Tam variants. Matching the Render log line (Anthropic request ID) is still to do. |
| Live APK (`preview-live`) | Built 2026-11-22, 0.2.6 (2): [build](https://expo.dev/accounts/dhruvmehan/projects/starfish/builds/cafe79f2-ecd4-4b95-9a9f-1fd84cde27bb) · [APK](https://expo.dev/artifacts/eas/r9lLlwITHASS52GWz7qEmUJ2lZ7ohr78Ck4GSfNNlV0.apk) |
| Live AAB (`production-live`) | Built 2026-11-22, 0.2.6 (2), signed with the EAS upload key: [build](https://expo.dev/accounts/dhruvmehan/projects/starfish/builds/8d84653c-ae92-4a9e-b643-0a7ad9a8f1ce) · [AAB](https://expo.dev/artifacts/eas/SZjcswxCuqUDSkc8EZopH1o9VwE_ngOtm5zi3L-DWc4.aab). Not uploaded to Play. |
| Device test | Not done yet (owner's phone). |

## Layout

| Path | Role |
| --- | --- |
| src/shopping_assistant/__main__.py | CLI and exit codes |
| src/shopping_assistant/server.py | `POST /recommendations` (tester code) and `GET /healthz` over the same harness |
| src/shopping_assistant/smoke.py | One-shot check of a deployed API |
| render.yaml, requirements.txt | Render Blueprint and pinned runtime dependencies |
| src/shopping_assistant/harness.py | Fixed run sequence, envelopes, trace record |
| src/shopping_assistant/provider.py | Provider protocol, canned mock, Anthropic adapter |
| src/shopping_assistant/validation.py | Strict JSON, schema and rule checks |
| src/shopping_assistant/trace.py | Metadata JSONL |
| prompts/ | Runtime system prompt sent to the model |
| schemas/ | Request, model-output and public-response contracts |
| examples/ | Mock request/output and sample envelopes |
| tests/ | Offline tests (network blocked; the server test allows loopback only) |
| mobile/App.tsx | List and search views |
| mobile/src/ | Demo catalogue, search adapter, list rules and storage |
| mobile/__tests__/ | Jest tests, including the acceptance journey through the UI |
| mobile/app.json, mobile/eas.json | App identity and build profiles |
| mobile/app.config.js | Fails a live build without a valid HTTPS origin |
