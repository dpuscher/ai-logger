# ai-logger

AI-powered geocaching log generator. Give it a cache code and your personal notes, and it writes a log entry in the style of the existing logs — matching the language, tone, and length.

## What it does

- Opens the geocache page using a browser (Puppeteer)
- Collects recent "Found it" logs to learn the cache's typical style
- Reads the cache description to detect any special logging requirements (photo upload, answer a question, etc.)
- Generates a log entry via an AI provider of your choice
- Optionally refines the log with additional notes
- Copies the final log to your clipboard and opens the geocaching.com log page

Supports two modes:
- **Manual**: enter one or more GC codes yourself
- **Drafts**: process all your pending geocaching.com field notes at once

## Prerequisites

- **Node.js >= 22**
- A **geocaching.com** account
- An API key for at least one supported AI provider (see below)

## Installation

```bash
npm install -g ai-logger
```

> **Note:** On first install, Puppeteer will automatically download Chromium (~360MB). This is a one-time download required for browser automation.

## First run

```bash
ai-logger
```

On first run, the setup wizard launches automatically. It guides you through:

1. Choosing an AI provider
2. Entering your model name and API key
3. Optionally saving your geocaching.com credentials for auto-login

Settings are saved to `~/.ai-logger/config.json`.

## Supported AI providers

| Provider | Notes |
|----------|-------|
| [OpenRouter](https://openrouter.ai) | Access to many models via one API key |
| [OpenAI](https://platform.openai.com) | GPT-4o, GPT-4 Turbo, etc. |
| [Groq](https://console.groq.com) | Fast inference, free tier available |
| [Together AI](https://www.together.ai) | Open-source models |
| [Fireworks AI](https://fireworks.ai) | Open-source models |
| [DeepSeek](https://platform.deepseek.com) | DeepSeek models |
| [Mistral AI](https://console.mistral.ai) | Mistral models |
| [Ollama](https://ollama.com) | Local, fully offline operation |
| Custom | Any OpenAI-compatible API endpoint |

## Usage

```bash
ai-logger
```

The main menu gives you:

```
What would you like to do?
  ▸ Enter geocache code manually
    Read from drafts
    ──────────────────
    Settings
    Exit
```

- **Enter geocache code manually** — type a GC code (e.g. `GC12345`) and enter your personal notes
- **Read from drafts** — fetches your pending drafts from geocaching.com and processes them in batch
- **Settings** — re-run the setup wizard to change provider, model, or credentials
- **Exit** — quit

## Environment variables

For CI or power users, environment variables override the config file:

```
OPENROUTER_API_KEY=...   # API key (also works as a general fallback key)
API_BASE_URL=...         # Override the API base URL
MODEL=...                # Override the model name
GEOCACHING_USERNAME=...  # Auto-login username
GEOCACHING_PASSWORD=...  # Auto-login password
```

Copy `.env.example` to `.env` to get started with env-based config.

## License

ISC
