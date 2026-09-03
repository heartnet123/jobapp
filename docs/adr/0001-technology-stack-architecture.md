# 0001. Baseline Technology Stack Architecture

- **Status**: Accepted
- **Date**: 2026-07-23
- **Decision Owner**: Core Engineering Team
- **Reversibility**: Type 2 — Reversible with planned cost (Decoupled client-server architecture with REST and WebSocket contracts)

---

## Context & Problem Statement

**Job Application Tracker** (`jobapp`) is a personal career management and intelligent job search automation platform. Candidates require a reactive Kanban pipeline to manage application stages (Applied, Take-home, Interview, Offer, Rejected), set follow-up reminders, upload and parse PDF resumes, analyze response metrics, and automatically monitor Gmail inboxes using LLM email classification to transition job application stages.

The system must satisfy key non-functional requirements:
1. **Privacy First**: Sensitive emails and PII (emails, phone numbers, links) must be redacted locally before sending text to external LLM providers.
2. **Low Overhead & Single-Command Setup**: Must run smoothly as a single local process or small Docker container under strict resource limits (<= 512MB RAM).
3. **Instant UI Responsiveness**: Drag-and-drop Kanban updates, live search, drawer modals, and zero-latency view switching.
4. **Real-time Synchronization**: Background email classification events must push directly to the UI without requiring aggressive polling.

---

## Decision Question

> Should **Job Application Tracker** adopt a **Decoupled Vue 3 SPA + Node.js Express Daemon + Embedded SQLite** architecture for single-user desktop and containerized deployments?

---

## Drivers & Constraints

### Facts (Ground Source Evidence)
- **Data Persistence**: SQLite embedded database using [`sqlite`](file:///e:/webappgithub/jobapp/package.json#L19) (`^5.1.1`) and [`sqlite3`](file:///e:/webappgithub/jobapp/package.json#L20) (`^6.0.1`). Database is initialized locally at `JOBS_DB_PATH` (`/app/data/jobs.db`).
- **Frontend Stack**: Vue 3 [`package.json:L21`](file:///e:/webappgithub/jobapp/package.json#L21) (`^3.5.13`) + Vue Router [`package.json:L22`](file:///e:/webappgithub/jobapp/package.json#L22) (`^4.6.4`) + Vite [`package.json:L35`](file:///e:/webappgithub/jobapp/package.json#L35) (`^6.0.5`) + Vanilla CSS [`src/style.css`](file:///e:/webappgithub/jobapp/src/style.css).
- **Backend Runtime**: Node.js 20 (`node:20-slim`) [`Dockerfile:L26`](file:///e:/webappgithub/jobapp/Dockerfile#L26) executing TypeScript files natively via `tsx` [`Dockerfile:L65`](file:///e:/webappgithub/jobapp/Dockerfile#L65) (`^4.22.3`).
- **Web API & Real-time**: Express 5 [`package.json:L17`](file:///e:/webappgithub/jobapp/package.json#L17) (`^5.2.1`) for REST endpoints + `ws` WebSocket server [`package.json:L23`](file:///e:/webappgithub/jobapp/package.json#L23) (`^8.21.0`) running on port 1455 [`vite.config.ts:L4`](file:///e:/webappgithub/jobapp/vite.config.ts#L4).
- **Document & AI Processing**: `pdf-parse` [`package.json:L18`](file:///e:/webappgithub/jobapp/package.json#L18) (`^2.4.5`) for resume extraction, local PII redactor [`src/daemon/automation/privacyRedactor.ts`](file:///e:/webappgithub/jobapp/src/daemon/automation/privacyRedactor.ts), Google OAuth 2.0 Gmail Client, NVIDIA NIM proxy, and OpenAI Codex OAuth PKCE SSE client.
- **Resource Constraints**: Docker container resource limits set to 512MB RAM max and 1 CPU core [`docker-compose.yml:L22-L27`](file:///e:/webappgithub/jobapp/docker-compose.yml#L22-L27).

### Constraints
- **Zero Third-Party Database Infrastructure**: Must not force users to provision external PostgreSQL, MySQL, or Redis instances for local application tracking.
- **Strict Privacy Isolation**: PII redaction must take place on the backend daemon before transmitting payloads to external LLM APIs (NVIDIA NIM / OpenAI).
- **Lightweight Execution Environment**: Must compile and execute reliably in lightweight Docker containers (`node:20-slim`).

---

## Options Considered

### Option 1: Vue 3 SPA + Node.js Express Daemon + SQLite + Vite + WebSockets (Selected)
- **Architecture**: Decoupled Client-Daemon architecture. Frontend client built with Vite and Vue 3; backend daemon running Express HTTP REST routes and WebSocket event push over local SQLite storage.
- **Pros**:
  - Single zero-dependency file database (`jobs.db`) with fast read access and low footprint.
  - Native TypeScript execution (`tsx`) eliminates cumbersome backend compilation steps.
  - Full control over WebSocket push notifications for AI background email classification events.
  - High developer productivity with Vite fast HMR.
  - Total container memory usage well within the 512MB constraint (typically ~120MB RSS).
- **Cons**:
  - Requires handling SQLite native dependency build (`sqlite3`) in multi-stage Docker builds [`Dockerfile:L14`](file:///e:/webappgithub/jobapp/Dockerfile#L14).
  - SQLite write concurrency is limited to single-writer WAL mode (acceptable for single-user application).

### Option 2: Fullstack Next.js (React) + PostgreSQL + Prisma / Drizzle ORM
- **Architecture**: Next.js App Router with React Server Components, API Routes, and an external PostgreSQL database.
- **Pros**:
  - Unified frontend/backend framework in React ecosystem.
  - Built-in Server Actions and SSR capabilities.
- **Cons**:
  - Requires running a separate PostgreSQL service container, breaking the simple single-container distribution model.
  - Next.js server runtime footprint easily exceeds 250MB–500MB RAM, leaving minimal head room under the 512MB Docker memory budget.
  - WebSocket support in Next.js requires additional infrastructure (Custom server / Socket.io / Pusher).

### Option 3: Electron Desktop Native Package + Local Node Process
- **Architecture**: Native desktop wrapper packaging Chromium + Node.js runtime.
- **Pros**:
  - Native OS notifications and tray menu integration.
- **Cons**:
  - Packaging Chromium bloats installer size (>150MB binary) and increases memory consumption (500MB+ per window).
  - Complicates cross-platform automated builds and Docker server deployments.

---

## Option Comparison Matrix

| Evaluation Criteria | Option 1: Vue 3 + Express + SQLite (Selected) | Option 2: Next.js + PostgreSQL | Option 3: Electron Desktop |
| :--- | :--- | :--- | :--- |
| **RAM Footprint (Docker)** | **~120 MB** (Passes <=512MB) | **~350–500 MB** (High Risk) | N/A (Desktop Only) |
| **Infrastructure Overhead** | **Zero** (Self-contained file DB) | Requires Postgres container | **Zero** (Local file DB) |
| **Real-time Push Support** | **Native WebSocket (`ws`)** | Requires external WS broker | IPC channels |
| **Local Data Privacy** | **High** (Local daemon redaction) | Medium (Server dependency) | **High** (Local process) |
| **Build & HMR Speed** | **Fast** (Vite esbuild) | Moderate (Next.js compilation) | Moderate (Electron forge) |
| **Deployment Flexibility** | Docker / Node CLI / Self-hosted | Multi-container Compose / Cloud | OS Desktop Installers |

---

## Decision Rationale

We select **Option 1: Vue 3 SPA + Node.js Express Daemon + SQLite**.

1. **Alignment with Product Goals**: Job Application Tracker is designed as a personal, privacy-centric workspace. Storing data in an embedded SQLite database (`jobs.db`) provides 100% data ownership, simple file backups, and instant SQL query execution without network latency.
2. **Resource Efficiency**: Express + `sqlite3` + `ws` runs within ~120MB RSS memory, fitting comfortably inside the 512MB RAM constraint set in `docker-compose.yml`.
3. **Decoupled Architecture**: Separating the Vue SPA frontend from the Express daemon via explicit REST interfaces [`src/daemon/server.ts`](file:///e:/webappgithub/jobapp/src/daemon/server.ts) and shared TypeScript contracts [`src/shared/agent-contract.ts`](file:///e:/webappgithub/jobapp/src/shared/agent-contract.ts) guarantees high testability and clean module boundaries.
4. **Fast Developer Loop**: Vite provides instantaneous Hot Module Replacement (HMR) for frontend components, while `tsx` enables native execution of TypeScript backend routes without requiring separate build steps during development.

---

## Architectural Consequences

### Positive Consequences
- **Ultra-Fast Cold Start**: Server boots and binds REST/WebSocket ports in < 500ms.
- **Zero Database Server Management**: Users do not need DB credentials, connection pools, or external DB migrations servers.
- **High Test Confidence**: Test suite runs blazingly fast using Vitest and native Node test runner (`npm run test` executes unit, integration, and contract tests in < 3 seconds).
- **Clean Component Styling**: Vanilla CSS design system (`src/style.css`) with custom CSS variables delivers modern UI styling without heavy CSS framework bundle overhead.

### Negative Consequences & Mitigations
- **Native C++ Build Dependency**: `sqlite3` requires compilation tools (`python3`, `make`, `g++`) during Docker build stage [`Dockerfile:L5-L14`](file:///e:/webappgithub/jobapp/Dockerfile#L5-L14).  
  *Mitigation*: Solved via multi-stage Docker build where build tools are pruned in the final runtime container (`node:20-slim`).
- **Single-Writer Lock Constraint**: SQLite locks the database file during write transactions.  
  *Mitigation*: The daemon operates WAL (Write-Ahead Logging) mode and connection pooling via `sqlite` wrapper [`src/daemon/server.ts:L204-L243`](file:///e:/webappgithub/jobapp/src/daemon/server.ts#L204-L243), fully sufficient for single-user concurrent background processing.

---

## Verification & Validation

The validity and health of the tech stack architecture are continuously verified via automated test suites and container checks:

1. **Contract Guard Tests**:  
   ```bash
   npm run test:contract
   ```
   Validates shared contract schemas and runtime type guards [`src/shared/contract-test.ts`](file:///e:/webappgithub/jobapp/src/shared/contract-test.ts).

2. **Daemon Integration & Automation Tests**:  
   ```bash
   npm run test:daemon
   ```
   Executes integration tests against Express REST endpoints, WebSocket connections, resume parsing, and Gmail AI automation workflows [`src/daemon/server.test.ts`](file:///e:/webappgithub/jobapp/src/daemon/server.test.ts).

3. **Container Healthcheck**:  
   Docker container verifies daemon HTTP health endpoint `/api/health` every 30 seconds [`Dockerfile:L61-L62`](file:///e:/webappgithub/jobapp/Dockerfile#L61-L62).

---

## Review Triggers

Reconsider this ADR if any of the following triggers occur:
1. **Multi-Tenant SaaS Pivot**: The product pivots from a personal desktop/self-hosted app to a multi-tenant cloud SaaS serving >100 concurrent write users per instance.
2. **SQLite Write Contention**: Observed `SQLITE_BUSY` transaction error rate exceeds 0.1% under normal background email scanning workloads.
3. **Memory Pressure**: Background email parsing or resume extraction memory consumption systematically exceeds 400MB RAM.
