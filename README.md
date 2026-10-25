# AI Evals

AI Evals helps you choose a model for your use case. It sends the same prompt to two or three models under the same settings, shows the answers side by side, and has an LLM judge score each one with its reasons.

## What it does

- Pick two or three models from a live catalog to compare, side by side
- The same prompt and the same settings go to every model
- Responses stream into the UI as they are generated
- An LLM judge scores every response on five metrics (correctness, instruction following, helpfulness, clarity and conciseness), highlights the strongest answer, and shows the reasoning behind each score

## Supported model providers

Models come from up to four providers, and they can be mixed freely within a single run:

| Provider | Env var | Where to get it |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| Anthropic | `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| OpenAI-compatible (vLLM, Ollama, LM Studio, ...) | `OPENAI_COMPATIBLE_BASE_URL` | Your own server; the API key is optional for local setups |

Fill in whichever keys you have in `backend/.env`. Providers without a key are skipped automatically when the catalog is built, so a missing key never breaks a run. Model ids are composite (`provider::model`), which lets you compare the same underlying model across providers, for example `openrouter::anthropic/claude-haiku-4.5` against `anthropic::claude-haiku-4.5`.

### Local and self-hosted models (OpenAI-compatible)

Any server that speaks the OpenAI chat-completions API works: vLLM, Ollama, LM Studio, llama.cpp, and similar tools. Point `OPENAI_COMPATIBLE_BASE_URL` at it:

```bash
# Ollama running locally (no key needed)
OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1
OPENAI_COMPATIBLE_API_KEY=

# A hosted or secured endpoint (key required)
OPENAI_COMPATIBLE_BASE_URL=https://your-endpoint.example.com/v1
OPENAI_COMPATIBLE_API_KEY=sk-your-key-here
```

The provider turns on as soon as the base URL is set. The key is optional because local servers usually don't check auth; when it is set, it is sent as an `Authorization: Bearer` header on every request. Model ids look like `openai-compatible::llama3.1-8b-instruct`, where the part after `::` is whatever model name your server reports.

The judge model is picked in the UI. It can come from OpenRouter, OpenAI or Anthropic, but not from an OpenAI-compatible endpoint, because those models aren't assumed to return structured JSON.

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Python, FastAPI, httpx |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Model access | OpenRouter, OpenAI, Anthropic, any OpenAI-compatible endpoint |
| Judging | LLM as judge, one call per metric |

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in at least one provider key
uvicorn app.main:app --reload --port 8000
```

Tests: run `pip install -r requirements-dev.txt`, then `python -m pytest` from `backend`.
They use fake providers and make no network calls.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 in your browser. The frontend calls the backend directly at `http://localhost:8000`, so start the backend on that port first.

## How a run works

1. Pick two or three models. A run needs at least two.
2. Write the shared prompt and, optionally, set temperature, top_p or max tokens. The run is blocked if a model's listed parameters don't include a setting you filled in (see Known limitations for native OpenAI and Anthropic models).
3. Watch the responses stream in side by side over server-sent events.
4. When every stream has finished, the judge scores the answers once, and each pane shows its per-metric scores with the overall winner highlighted.

## How judging works

- One judge call per metric scores all answers together on a 1 to 5 scale.
- Each scale has written anchors for a score of 1 and a score of 5.
- Answers are labelled with letters and shown in a random order, so the judge never sees model names and no model always comes first.
- The judge must come from a different model family than every compared model.
- Scores are scaled to 0 to 1 and combined using each metric's weight. When the top two are within 0.15, one extra head-to-head call decides.

## Known limitations

- Native OpenAI and Anthropic models are assumed to accept temperature and top_p. Newer models from both reject custom values, so leave those fields empty for them.
- The judge's scores are one model's opinion. Read the reasons, not just the numbers.
- A close result is decided by a single head-to-head call.
- An answer could contain text that confuses the judge. Nothing keeps one answer from influencing how the others are judged.
- The model lists are filtered by simple rules, so a few listed models may not work for chat.
- It handles 2 to 3 models and one prompt per run, and results are kept in memory only.
- The app uses Anthropic API version `2023-06-01`, because the newer `2026-10-21` version removes temperature entirely.
