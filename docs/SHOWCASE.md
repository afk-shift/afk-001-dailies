# Dailies — the showcase notes

Written by the agent that built it, for the video.

## What it is

Dailies turns a Claude Code session into a supercut. A CLI reads the session transcript from `~/.claude/projects`, condenses it into a small, redacted document, and publishes it to this site. The site plays it back like a film: prompts, replies, tool calls, commits, and the cast of subagents with the model each one ran on. An AI narrator writes the title, a synopsis, and a handful of highlights. Press `s` and it plays only the highlights.

Live: https://surprise-me-001.netlify.app

The featured supercut on the homepage is the session that built Dailies.

## Why this idea

You asked for something interesting to you, fully usable, and showcaseable, and you let me look around. Three things lined up:

- On September 4 you wrote in Slack that you wanted to revisit Supercuts but kept drowning in other things. The idea had been sitting since April.
- Your `roster` skill exists because Claude Code never shows which model ran which subagent. Dailies puts that on screen for every session.
- You think in narrated artifacts of agent work: the video-to-published pipeline post, the "Claude as creative director" post. A replay page is the artifact.

It also had the right shape for an unattended run: a parser with a fixture, a publish endpoint, a player, and one AI call, each checkable on its own. And it could tell its own story, which seemed like the right kind of surprise for a video about leaving an agent alone for 36 hours.

## Try it in 60 seconds

```sh
git clone git@github.com:seancdavis/surprise-me.git dailies
cd dailies && npm install
netlify env:get DAILIES_PUBLISH_TOKEN --context production   # paste into .env
npm run dailies -- <any session id from ~/.claude/projects/*/>
```

The CLI prints a summary, a redaction count, and a URL. Give the narrator a minute and refresh.

## A demo script for the video

1. Open the homepage. Click the featured supercut.
2. Press space. Watch the reel fill in: your first prompt, the four cron wakeups, the exploration agents spawning, the first commits.
3. Press `s`. The supercut plays the six narrated highlights with dissolves between them. Click a diamond on the scrubber to jump.
4. Add `?chrome=none` to the URL for a clean full-frame recording.
5. In a terminal, start any Claude Code session, then run `npm run dailies -- <that session id> --watch`. Open the printed URL. The page shows a LIVE pill and fills in as the session runs. Ctrl-C the watcher and the narrator finishes the page.
6. Show `/s/<slug>.json` if you want to talk about the data.

## How it was built

Four sessions on your cadence (3pm, 7pm, 11pm, 3am), each budgeted at two hours and each finished early. I orchestrated and measured; Sonnet and Opus subagents wrote every line of code; Codex audited read-only in three lenses. Every slice had a check I ran myself before advancing, and every push to main was a production deploy.

By the numbers, from the featured supercut's own JSON:

| | |
|---|---|
| wall clock, first prompt to last | 17h 53m (about 5h of it working) |
| prompts | 6: two from you, four from cron |
| cast | 27: me on Fable, 23 Sonnet developers and researchers, 3 Opus developers |
| tool calls | 1,420, 15 of them errors |
| files touched | 76 |
| commits | 25 by subagents, 29 in git including my doc commits |
| tokens | 12.3M in, 847K out, plus 311M cache reads |
| tests at the end | 188 |
| redactions in the published transcript | 4, all the same publish token |

Findings the audits caught and the developers fixed, in rough order of how much they mattered:

- Redaction was a narrow denylist and only ran client-side. Now it covers credential URLs, private keys, JWTs, Basic auth, and `KEY=value` shapes, and runs again on the server before storage.
- The dry-run filename came from the transcript, so a hostile transcript could write outside the output directory.
- The narration trigger was fire-and-forget inside a serverless function, which can drop it on freeze. It worked twice by luck before the audit caught it.
- Ctrl-C in watch mode could race an in-flight publish and let a stale document land last.
- The live page polled forever. It now stops when narration appears, since the final publish narrates.
- The done-signal rehearsal in session 3 caught a regression the audits had missed: a fresh publish without `--update` failed with 400, because the CLI had started sending the parser's empty slug and the server validated any slug it saw. Every publish since that change had used `--update`, which hid it. This is the argument for measuring instead of trusting a clean audit.

Things only real data showed: the first prompt's title was a `/plugin` command marker, subagent completion notices were becoming chapters, the cron-fired prompt was silently dropped because it carries `isMeta`, commits made by subagents never reached the reel, and cache reads made the token count read 68 million.

## What surprised me

- The transcript format is richer than it looks. Subagent runs live in sibling files joined by `toolUseId`, scheduled prompts are marked meta, and the per-line `model` field means attribution is exact.
- Narration quality with a compact digest is good. The narrator titled the first draft of this session "Overnight Build" and later "36 Hours Unattended: Building Dailies While Sean Was Away", without being told the premise beyond the transcript.
- Your machine ran out of memory in session 2, from Chrome and other sessions, not from this work. Two background jobs were killed. Running audits and developers one at a time cost about ten minutes overall.

## Not done, and known rough edges

- No video export. This is the web replay; Supercuts as a video product is still yours.
- No listing of published supercuts. Pages are unlisted by random slug; only the featured one is linked.
- "+N since you opened" counts events, mostly tool calls. Turns or commits would say more.
- The chapter rail and side panel still scroll independently on desktop; fade masks would look better than scrollbars.
- No Open Graph image, so link previews are text only.
- Codex's model on this machine is set to extra-high reasoning; I ran audits at medium to keep them quick.

## Please verify by hand

- Play the featured supercut end to end. The prompt text and my reply text from this session are public on that page; tool results are not. Four redactions were applied. If anything there should not be public, `--update` it with `--title` or re-feature another session.
- The mobile layout on a real phone. I measured it in an iframe, which is not the same thing.
- Narration on one of your own sessions.
- Watch mode on a session that spawns subagents while you watch.
