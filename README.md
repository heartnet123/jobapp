# Job Application Tracker

Personal career pipeline tracker and automated job search assistant with local-first persistence, real-time updates, and LLM-powered inbox automation.

---

## Features

- **Interactive Kanban Pipeline**: Drag-and-drop or status-driven application workflow (`Applied`, `Take-home`, `Interview`, `Offer`, `Rejected`).
- **Application Drawer & Tracking**: Track contacts, interview rounds, salary expectations, follow-up deadlines, and checklist tasks per application.
- **Automated Gmail Sync**: Background daemon polls Gmail for recruiter communications, interview requests, and application status updates.
- **AI-Powered Email Classification**: Categorizes recruitment emails using **OpenAI Codex / ChatGPT Plus OAuth** (zero API credit cost) or **NVIDIA NIM** (e.g., Llama 3.1 405B).
- **Privacy First (Local Redaction)**: Scrubs sensitive personal identifiable information (PII) before sending message snippets to AI models.
- **Human-in-the-Loop Review**: Staging queue for ambiguous emails before modifying application records.
- **PDF Resume Parsing**: Ingests PDF resumes locally using `pdf-parse` to populate candidate profile records.
- **Live Notifications**: WebSocket push updates keep frontend views synchronized with backend polling actions.

---

## Architecture

The project is structured as a monorepo workspace:

```text
├── frontend/   # Vue 3 SPA, Vite, TypeScript, Vue Router
├── backend/    # Express 5 REST API, WebSockets, SQLite, Gmail & LLM automation
├── shared/     # Shared TypeScript domain contracts, schemas, and validators
└── docs/       # Architecture decisions (ADRs) and codebase specifications
```

---

## Prerequisites

- **Runtime**: [Node.js](https://nodejs.org/) (v20+) or [Bun](https://bun.sh/) (v1.1+)
- **Container Engine** (optional): [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)

---

## Quickstart

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/heartnet123/jobapp.git
cd jobapp
bun install
```

> [!TIP]
> You can also use `npm install` if Bun is not installed in your local environment.

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` to configure your preferred ports and optional integrations:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3001` | Backend daemon HTTP/WebSocket port |
| `JOBS_DB_PATH` | `jobs.db` | SQLite database file location |
| `GOOGLE_OAUTH_CLIENT_ID` | — | Google Cloud OAuth Client ID for Gmail reading |
| `GOOGLE_OAUTH_CLIENT_SECRET`| — | Google Cloud OAuth Client Secret |
| `OPENAI_CODEX_CLIENT_ID` | — | OAuth Client ID for ChatGPT Plus/Pro quota access |
| `NVIDIA_NIM_API_KEY` | — | API key for NVIDIA NIM LLM classification alternative |

> [!NOTE]
> AI classification and Gmail sync are optional. The pipeline tracker and local resume manager function fully offline using local SQLite storage without external API keys.

### 3. Run Development Servers

Start both frontend and backend concurrently:

```bash
bun run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

To run components individually:

```bash
bun run dev:frontend   # Starts Vite dev server
bun run dev:backend    # Starts daemon with tsx watch
```

---

## Docker Deployment

Run the complete multi-container setup (Express backend daemon + Nginx frontend SPA):

```bash
docker compose up -d --build
```

- Web UI: `http://localhost:8080`
- API Health Check: `http://localhost:3001/api/health`

Stop containers:

```bash
docker compose down
```

---

## Verification & Testing

Run contract validation and backend test suites:

```bash
# Run all tests
bun test

# Run contract tests only
bun run test:contract

# Run backend unit & integration tests
bun run test:backend

# Run Oxlint code inspection
bun run lint
```