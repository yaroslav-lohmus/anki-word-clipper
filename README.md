# Anki Word Clipper — Estonian / Finnish

A small Chrome extension for reading Estonian on ERR. Select a word or sentence, optionally translate it into Finnish through OpenRouter, and save an editable card with its original context to Anki Desktop.

This MIT-licensed fork of [ArtCog/anki-word-clipper](https://github.com/ArtCog/anki-word-clipper) removes the local CLI bridge, alternative translation providers, arbitrary API endpoints, automatic Google fallback, batch extraction, instant-add mode, and speech configuration. The interface is English. There is no application server, build step, or runtime package dependency.

## Installation

1. Install Anki Desktop and AnkiConnect: Tools → Add-ons → Get Add-ons → `2055492159`. Restart Anki and keep it running.
2. Clone this fork into a permanent directory.
3. In Chrome, open `chrome://extensions`, enable Developer mode, and choose Load unpacked. Select the repository directory containing `manifest.json`.
4. Open the extension popup and approve its connection in Anki.
5. Optionally save an OpenRouter API key and enable translation. Translation is initially off. Choose Gemini 3.1 Flash Lite or Gemini 2.5 Flash Lite.
6. Open an ERR article, select text, and click + Anki. You can also right-click → Add to Anki or press Option+A on macOS (Alt+A elsewhere).
7. Check the meaning, choose a deck, and save. Sync Anki Desktop and your phone through AnkiWeb.

When upgrading an already loaded copy, click Reload in `chrome://extensions` and reload any open ERR tabs. Upgrading from the original version disables translation until you explicitly enable it again. Old provider keys, endpoints, and unused preferences are removed. An existing OpenRouter key is retained only when its old endpoint exactly matches the OpenRouter preset.

## Cards

Basic, both directions, reverse-only, and missing-word (cloze) cards are supported. Dictionary forms are saved when supplied by the model; the original inflection remains in the source sentence and is used for the cloze gap. Existing note-type fields remain compatible. Long selections are translated as sentences rather than converted into batches of words. Model translations need your review; you can edit them or enter a meaning manually.

## Privacy and security boundaries

- Page scripts run only on HTTPS `err.ee` and its subdomains, in the top frame. Other sites and Firefox are outside this fork's supported scope.
- Network access is limited to OpenRouter and loopback AnkiConnect. There are no analytics, CLI processes, remotely loaded scripts, or automatic provider fallbacks.
- When you enable translation and open a card form, selected text and limited surrounding context go to OpenRouter and its selected model provider. The Test translation button explicitly sends a fixed Estonian example even when automatic translation is off. Requests omit cookies and reject redirects.
- Article title and URL are saved with the card in Anki; they are not included in translation requests. Cards can subsequently sync through AnkiWeb under your Anki settings.
- API keys live in extension-local storage restricted to trusted extension contexts. Keys are not returned in settings responses, including responses to the popup. Storage is not an encrypted credential vault. Use a dedicated spending-limited OpenRouter key.
- Only the extension popup can change credentials and model settings. ERR content scripts can request bounded translations and card creation, list decks, and remember the card type; they cannot choose endpoints or execute arbitrary AnkiConnect actions.
- One translation can run at a time, with a timeout and an output-token limit. These bounds reduce accidental request bursts, but are not a substitute for provider-side spending limits.
- Keep AnkiConnect on its default loopback address. Browser extensions and local software still require trust; this hardening is not a guarantee against every vulnerability.

## Development

Use pnpm only. pnpm automatically supplies the pinned Node 24 runtime required by Promptfoo; no global Node upgrade is needed. Dependencies are development tooling; they are not loaded by the extension.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm fmt
```

`pnpm check` runs Oxlint, Oxfmt, and Node's test runner. Tests cover context extraction, card generation and HTML escaping, message trust boundaries, key isolation, legacy settings migration, fixed provider destinations, and translation failure behavior. Network calls and Anki are mocked in automated tests; they create no real cards and spend no API credits.

## Translation evaluations

The small Promptfoo suite in `promptfooconfig.cjs` compares Gemini 3.1 Flash Lite and Gemini 2.5 Flash Lite on 20 Estonian–Finnish cases. It exercises the production prompt, request builder, and response parser. Cases include inflections, fixed expressions, ambiguous meanings, Finnish false friends, full sentences, and prompt injection in quoted article context.

```sh
pnpm eval:offline                       # Synthetic fixtures; no API key or network calls
cp .env.example .env                    # First time only; fill the key locally
pnpm eval                              # Live comparison: 20 cases × 2 models = 40 requests
pnpm eval:summary                      # Pass counts, p50/p95 latency and reported model cost
pnpm eval:view                         # Local Promptfoo results browser
```

Never paste your key into chat or commit `.env`. A browser extension's saved key is not automatically available to command-line evaluations. `pnpm eval` fails before making requests when the key is missing. The adapter does not contact another provider on failure. Promptfoo telemetry and update checks are disabled for these commands. Reports and its local database remain in ignored `output/` files; nothing is automatically shared.

For a smaller paid run or one model:

```sh
pnpm eval --filter-first-n 3
pnpm eval --filter-providers 'Gemini 3.1 Flash Lite'
```

Each run disables response caching so changed prompts and latency measurements use fresh responses. These are small-sample latency observations, not a production SLA. Cost comes from OpenRouter's reported usage when present; missing cost is shown as unknown rather than zero. Failures and extra reasoning tokens can affect actual billed usage. Results are written to `output/eval-live.json` and the local Promptfoo history; the JSON file is overwritten on each run.

### Tuning the prompt and cases

1. Review the current outputs in `pnpm eval:view`, including plausible translations that fail an assertion.
2. Edit `AI_SYSTEM_PROMPT` in `translator.js` and rerun the same suite. The cache fingerprint includes the production prompt.
3. Add real troublesome selections to `evals/cases.cjs`: an ID, selected word, sentence, optional wider context, accepted dictionary forms, Finnish meaning fragments, and optional forbidden or required fragments.
4. Keep a few new cases out of prompt tuning and use them to check that improvements generalize.

The included expectations are seed examples, not a fluent-speaker-certified reference. The checks deliberately use accepted dictionary forms and meaning fragments instead of exact sentence matches; valid synonyms can still need adding. They do not prove that every grammatical explanation is correct. Have a fluent Estonian speaker review ambiguous cases. No extra LLM judge is used or billed.

The offline suite only validates fixture transport, parsing, assertion wiring and reports; its pass rate says nothing about model translation accuracy. `pnpm check` also tests that wrong senses fail and that the eval adapter redacts credentials and uses the fixed production endpoint. CI runs these free checks, not paid model calls.

This is prompt/model evaluation and tuning, not training model weights or uploading a fine-tuning dataset.

## License

[MIT](LICENSE). Original copyright attribution is preserved.
