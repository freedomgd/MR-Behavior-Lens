# MR Behavior Lens

Review GitLab merge requests by answering one question: **"what behavior did this change?"**

Instead of reading a raw diff line by line, MR Behavior Lens analyzes the MR and shows you a review organized around *behavior changes* — including before/after **Mermaid sequence diagrams** (🔴 flows that disappeared / 🟢 new flows) with `[file:line]` references you can click to jump straight to the code.

[ภาษาไทย → README.th.md](README.th.md)

## Features

- **Behavior-first review** — the diff is grouped into behavior groups, each with a summary, behavior changes, findings, and a before/after sequence diagram
- **Clickable diagrams** — click `[file:line]` in a diagram or finding to open the code (falls back to opening GitLab if the file isn't in your workspace)
- **Post comments back to the MR** — post any finding as an inline comment on the diff, or write a free-form comment, right from the review panel (always shows an editable input box before posting)
- **Works with your existing LLM** — uses the VSCode Language Model API (GitHub Copilot or an enterprise LM provider) if available, or your own Anthropic API key
- **Self-hosted GitLab supported** — point `mrLens.gitlab.url` at your instance
- **Token usage dashboard** — see today / 7-day / all-time usage, per-MR breakdown, and recent requests

## Getting started

1. Install the extension, then open a workspace whose git remote points at your GitLab project (or set `mrLens.gitlab.projectId` manually).
2. Run **`MR Lens: Set GitLab Token`** — a personal access token with `read_api` scope (`api` scope if you want to post comments). The token is kept in VSCode secret storage.
3. Pick an LLM:
   - If you're signed in to GitHub Copilot (or an enterprise LM provider), it works out of the box (`mrLens.provider: auto`), or
   - Run **`MR Lens: Set Anthropic API Key`** to use the Anthropic API directly.
4. Self-hosted GitLab? Set `mrLens.gitlab.url` (default `https://gitlab.com`).
5. Run **`MR Lens: Review Merge Request…`** and pick an MR.

Want to see it without any setup? Run **`MR Lens: Demo Review (sample data)`**.

> **Cost note:** reviews are powered by an LLM, so they consume your Copilot quota or Anthropic API credits. The extension is built to keep this small (see below), asks for confirmation before any review estimated to exceed `mrLens.tokenBudget` (default 30k input tokens), and ships a token usage dashboard (**`MR Lens: Token Usage`**) so you always know what you spent.

## How it keeps token usage low

1. **Local pre-processing (0 tokens)** — filters lockfiles/generated/binary files, truncates oversized diffs, extracts function names with regex
2. **Two-stage pipeline** — a cheap model (e.g. `claude-haiku-4-5` / smallest Copilot model) groups the diff into behavior groups first; the main model only analyzes one group at a time
3. **Budget guard** — asks before sending anything estimated over `mrLens.tokenBudget`
4. **Cache by diff hash** — re-opening a review of an unchanged MR costs 0 tokens
5. **Capped LSP context** — callers/callees are attached only where needed, up to `mrLens.contextBytesPerGroup` (4 KB) per group

## Commands

| Command | What it does |
|---|---|
| `MR Lens: Review Merge Request…` | Pick an MR from a list and open the review panel |
| `MR Lens: Demo Review (sample data)` | Try the review UI with bundled sample data — no setup needed |
| `MR Lens: Set GitLab Token` | Store your GitLab PAT in secret storage |
| `MR Lens: Set Anthropic API Key` | Store your Anthropic API key in secret storage |
| `MR Lens: Select LLM Model…` | Pick models for the classify/analyze stages from the active provider |
| `MR Lens: Token Usage` | Open the token usage dashboard |
| `MR Lens: Clear Review Cache` | Clear cached review results |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `mrLens.gitlab.url` | `https://gitlab.com` | GitLab instance base URL (self-hosted / enterprise supported) |
| `mrLens.gitlab.token` | empty | GitLab PAT via settings — overrides secret storage. ⚠️ Plain text; prefer the `Set GitLab Token` command |
| `mrLens.gitlab.projectId` | empty | Project ID or URL-encoded path. Empty = derived from the workspace git remote |
| `mrLens.provider` | `auto` | `auto` = try VSCode LM (Copilot/enterprise) first, fall back to Anthropic API key |
| `mrLens.model.classify` / `analyze` | empty | Per-stage model override — easiest to set via `MR Lens: Select LLM Model…` |
| `mrLens.tokenBudget` | `30000` | Input-token estimate above which the extension asks for confirmation |
| `mrLens.maxGroups` | `5` | Max behavior groups analyzed per MR |
| `mrLens.contextBytesPerGroup` | `4096` | Cap on extra LSP context per group |

## License

[MIT](LICENSE)
