# AI Evals

Compare AI models on **output quality**, not price or latency. Send one prompt to several models under an identical inference configuration, watch the responses stream in side by side, and let an LLM-as-judge score every answer on five fixed metrics: correctness, instruction-following, helpfulness, clarity, and conciseness. The strongest response gets highlighted.

## What it does

- Pick any models from a live catalog to compare, side by side
- One shared prompt and one shared set of inference parameters for every model, so the comparison is fair by construction
- Responses stream into the UI as they are generated
- An LLM judge scores every response per metric, highlights the strongest answer, and shows the reasoning behind each score

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

The judge model is picked in the UI and can be any model from any configured provider.

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Python, FastAPI, httpx |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Model access | OpenRouter, OpenAI, Anthropic, any OpenAI-compatible endpoint |
| Judging | LLM-as-judge with pairwise G-Eval-style rubrics |

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

Then open http://localhost:5173 in your browser. The dev server proxies API calls to the backend on port 8000.

## How a run works

1. Pick two or more models from the catalog.
2. Write the shared prompt and set the shared parameters. The run only starts once every selected model supports every parameter.
3. Watch the responses stream in side by side over server-sent events.
4. When the stream settles, evaluate. The judge compares responses in pairs under blind letters, and each pane then shows its per-metric scores with the overall winner highlighted.

