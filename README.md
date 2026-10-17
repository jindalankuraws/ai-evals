# AI Evals

Compare AI models on **output quality** — not price or latency. Send one prompt to several models under an identical inference configuration, watch the responses stream in side by side, and let an LLM-as-judge score each answer on metrics like correctness, groundedness and helpfulness.

## What it does

- Pick any models from a live catalog to compare, side by side
- One shared prompt and one shared set of inference parameters for every model — a fair, apple-to-apple comparison by construction
- Responses stream into the UI as they are generated
- An evaluation engine scores every response per metric, highlights the strongest answer, and shows the reasoning behind each score

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Python, FastAPI, httpx, SQLAlchemy |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Model access | OpenRouter| Model access | OpenRouter| Model access | OpenRouter| Model access | OpenRouter| Model access | OpenRouter| Model access |source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add your OpenRouter API key
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

## Documentation

See [PLAN.md](./PLAN.md) for the full architecture, design decisions and the phased roadmap.
