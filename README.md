# Dailies

Supercuts of your Claude Code sessions.

A local CLI reads a Claude Code session transcript from `~/.claude/projects`, condenses it into a compact, redacted "supercut", and publishes it to this site. The site renders an animated, scrubbable replay: prompts, replies, tool calls, commits, the cast of subagents with their models, live counters, and an AI-written synopsis with clickable highlights.

Live: https://surprise-me-001.netlify.app

## Try it in 60 seconds

```sh
git clone git@github.com:seancdavis/surprise-me.git dailies
cd dailies
npm install
cp .env.example .env            # then paste the publish token (see below)
npm run dailies -- <sessionId>  # any session id from ~/.claude/projects/*/
```

The CLI prints a summary, publishes, and returns a URL like `https://surprise-me-001.netlify.app/s/abc123defg`. Narration is generated in the background; give it up to a minute and refresh.

Find a session id with `ls ~/.claude/projects/<your-project-dir>/`. The CLI also accepts a path to a `.jsonl` file.

Flags:

| Flag | What it does |
|---|---|
| `--dry-run` | Parse only; writes `dailies-out/<sessionId>.json`, no network |
| `--title "..."` | Override the title (the narrator may still refine it) |
| `--feature` | Make this supercut the one linked from the homepage |
| `--no-narrate` | Skip AI narration for this publish |
| `--site https://...` | Publish to a different deployment |

## The publish token

Publishing is gated by a bearer token stored as the `DAILIES_PUBLISH_TOKEN` environment variable on the Netlify site (secret, functions scope). Pull it into your local `.env` with:

```sh
netlify env:get DAILIES_PUBLISH_TOKEN --context production
```

## What gets published, and what doesn't

The supercut contains prompt text, assistant reply text (capped), one-line tool labels (a command's first line, a file path, a pattern), commit messages, subagent names and models, counts, and timestamps. Tool results are never included. Every string is passed through a secret redactor (API keys, tokens, JWTs, credential URLs, private keys, `KEY=value` assignments) both in the CLI and again on the server before storage. The CLI prints how many redactions it applied; review with `--dry-run` if that number surprises you.

Pages are unlisted: the slug is random and server-generated, and only the featured supercut is linked from the homepage.

## Stack

Astro (SSR) on Netlify with a React island for the player, Tailwind v4, Netlify Blobs for storage, Netlify Functions for `POST /api/publish`, `POST /api/feature`, and the background `POST /api/narrate`, and the Netlify AI Gateway for narration (Anthropic, `claude-sonnet-5`). Set `DAILIES_NARRATE=off` on the site to disable narration.

## Local development

```sh
npm install
netlify dev            # site + functions + Blobs sandbox at http://localhost:8888
npm test               # vitest
npm run typecheck      # astro check
npm run build
```

`/s/demo` renders a synthetic fixture from `tests/fixtures/`, so the player works locally without publishing anything.

## Deploying

Push to `main`. Netlify builds and deploys. The only site configuration outside this repo is the `DAILIES_PUBLISH_TOKEN` env var.

## How this was built

Dailies was built unattended over four two-hour Claude Code sessions while its owner was away, as an experiment. The first featured supercut is the session that built it. See `docs/SHOWCASE.md`.
