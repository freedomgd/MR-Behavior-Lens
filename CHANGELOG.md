# Changelog

## 0.1.6 — 2026-07-11

Initial public release.

- Review GitLab merge requests as behavior groups: summary, behavior changes, findings, and before/after Mermaid sequence diagrams (🔴 removed flows / 🟢 new flows)
- Clickable `[file:line]` references — open code in the workspace, or on GitLab if the file isn't local
- Post findings as inline MR comments, or free-form comments, from the review panel
- LLM providers: VSCode Language Model API (GitHub Copilot / enterprise) with fallback to the Anthropic API
- Two-stage pipeline (cheap classify → per-group analyze), token budget guard, diff-hash cache, capped LSP context
- Token usage dashboard (today / 7 days / all time, per-MR breakdown)
- Self-hosted GitLab support via `mrLens.gitlab.url`
- Secrets kept in VSCode secret storage (`Set GitLab Token` / `Set Anthropic API Key`)
