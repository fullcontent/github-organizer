# 🚀 GitHub Organizer

**GitHub Organizer** is a self-hosted, open-source dashboard for organizing and prioritizing **GitHub issues** with **AI**. It gives any repository a **Kanban board**, a **milestone tracker**, a **manager dashboard with effort/hours estimation**, and **analytics & charts** — all backed by a lightweight Node.js/Express server and plain static pages (no build step, no framework lock-in).

🇧🇷 Leia em português: [README.pt-BR.md](README.pt-BR.md)

---

## Why GitHub Organizer?

Plain GitHub Issues work, but they don't give you:
- A **priority-based Kanban board** (P0–P3) with a dedicated backlog column and live search.
- A **1-paragraph AI explanation** of any issue — context, problem, and expected impact — generated on demand.
- A **manager-friendly dashboard** that estimates **monthly engineering hours** from issue complexity + commit volume.
- **Analytics & charts** with flexible time ranges (7d/14d/30d/90d/6m/1y/custom) and day/week/month grouping.
- **Dark mode**, a **PT/EN language switcher**, and zero-dependency static pages you can deploy anywhere.

It works with **any GitHub repository** you have access to — just point it at `owner/repo` and a token.

---

## ✨ Features

1. **📋 Issue List (`/`)**
   - Inline milestone and priority assignment directly in a dense, single-row table.
   - Full-width layout (`96%`), live search/filter by title, number, or label.
   - Dark / Light mode toggle with persistence.

2. **📌 Priority Kanban (`/kanban.html`)**
   - Split layout: a dedicated **Backlog** column (no priority) with live search, and a board with priority columns (**P3 – Low**, **P2 – Medium**, **P1 – High**, **P0 – Critical**).
   - Compact cards (max 2 lines) so dozens of issues fit on screen without excessive scrolling.
   - **🤖 1-paragraph AI explanation** in a modal — click any card to see what the issue is about, the problem/need, and the expected impact.

3. **📊 Manager Dashboard & Hours Estimation (`/dashboard.html`)**
   - **💾 Smart local persistence** — data and metrics are cached in `data/dashboard_cache.json` for instant loads.
   - **🔄 On-demand sync** — click "Sync Data (AI)" to pull fresh data from GitHub and recompute effort analysis.
   - **⏱️ Monthly hours estimation** — the AI evaluates issue text complexity together with commit/file-change volume to produce a weighted estimate of the team's monthly development hours.
   - **Executive charts** — monthly commits, issue mix, and created vs. closed flow.

4. **📈 Analytics & Charts (`/analytics.html`)**
   - Time-range filters (7d, 14d, 30d, 90d, 6 months, 1 year, custom).
   - Grouping by day, week, or month.
   - Bar/line chart toggle.
   - Drill-down into every issue and commit with direct links.

5. **🎯 Milestones (`/milestones.html`)**
   - Kanban-style board for milestones with drag-to-reorder columns, progress bars, and due dates.

6. **🌐 PT/EN language switcher** on every page (persisted per browser), plus full **dark mode** support.

---

## 🚀 Getting Started

### Requirements
- Node.js 18+
- Git / GitHub CLI (`gh`) authenticated, **or** a GitHub Personal Access Token (PAT)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your environment
```bash
cp .env.example .env
```
Then edit `.env` and set at least:
```env
GITHUB_REPO=owner/repo
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Run it
```bash
npm start
```
Or in dev mode:
```bash
npm run dev
```

Open in your browser:
- **Issue List:** [http://localhost:3000/](http://localhost:3000/)
- **Priority Kanban:** [http://localhost:3000/kanban.html](http://localhost:3000/kanban.html)
- **Manager Dashboard:** [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)
- **Charts & Analytics:** [http://localhost:3000/analytics.html](http://localhost:3000/analytics.html)
- **Milestones:** [http://localhost:3000/milestones.html](http://localhost:3000/milestones.html)

---

## ⚙️ AI Configuration

GitHub Organizer supports multiple AI providers with automatic fallback to a built-in heuristic engine when no AI is configured or reachable.

### Option 1: Self-hosted Ollama (local or private server/proxy)
If you run your own Ollama server (locally, on your network, or behind a reverse proxy / Tailscale):

1. **Pick a client/project name** — e.g. `my-project`. It's sent in the `X-Client-Name` header, useful if you run a monitoring proxy in front of Ollama.
2. **Point to your server**, e.g. `http://localhost:11434` (default) or your own private URL/proxy.
3. **Configure via the Web UI or `.env`:**
   - **Web UI:** open the AI Settings modal (gear icon) and fill in the server URL, model, and client name.
   - **`.env`:**
     ```env
     OLLAMA_URL=http://localhost:11434
     OLLAMA_CLIENT_NAME=my-project
     OLLAMA_MODEL=gemma3:12b
     OLLAMA_API_KEY=
     ```
4. **Streaming with an OpenAI-compatible API:** to measure token usage while streaming, send `"stream_options": { "include_usage": true }`.

> 💡 **Note:** If Ollama credentials are missing or incorrect, GitHub Organizer automatically falls back to its **built-in heuristic engine**, and the UI shows a note about it.

### Option 2: Google Gemini (free tier available)
1. Get a free key at [Google AI Studio](https://aistudio.google.com/).
2. Add to `.env`:
   ```env
   GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxx
   GEMINI_MODEL=gemini-1.5-flash
   ```

### Option 3: OpenAI / any OpenAI-compatible gateway
```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

---

## 🔑 GitHub Configuration

The app resolves a GitHub token automatically, in priority order:
1. `GITHUB_TOKEN` in `.env`
2. `GITHUB_TOKEN_CLASSIC` in `.env`
3. `GITHUB_TOKEN_FINE` in `.env`
4. **Local GitHub CLI:** if you're logged in via `gh auth login`, the token is used automatically — no setup needed.

You can also paste/rotate a token directly from the Web UI (AI Settings → GitHub Token), which is stored locally and never committed to git.

```env
GITHUB_REPO=owner/repo
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 📐 How the monthly hours estimate works

When you trigger a sync from the **Manager Dashboard**:
1. The backend collects all issues created/updated in the last month.
2. The backend collects the month's commits and samples file/line change volume.
3. That data is sent to the configured AI model (or processed by the calibrated heuristic engine) using:
   - **Issue component:** scope/requirement complexity, labels (bug vs. feature vs. refactor), priority (P0–P3).
   - **Commit component:** files changed, additions/deletions, delivery frequency.
   - **Weighted average:** a final hours estimate with a short analysis paragraph justifying the number.
4. The result is cached in `data/dashboard_cache.json` for instant loading on future visits.

---

## 🔒 Security & privacy notes

- All local runtime state (`data/*.json`) is generated by the app and **gitignored** by default — nothing from your repository, issues, or AI keys is committed.
- Your GitHub token and AI keys are stored only in local, untracked files (`data/github_config.json`, `data/ai_config.json`) or environment variables — never hardcode real credentials in files you intend to commit or share.

## 🤝 Contributing

Issues and pull requests are welcome. This project has no hard dependency on any specific company, repository, or infrastructure — it's designed to work with any GitHub repo out of the box.

## 📄 License

ISC
