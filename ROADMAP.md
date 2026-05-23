# Job Application Tracker — Product Roadmap

```text

Project: Job Application Tracker
Vision: The smartest personal command center for managing your entire job search, from first application to signed offer.
Phases: 4
Features: 32
Competitor Analysis Used: yes
Features Addressing Competitor Pain Points: 11

Breakdown by priority:
- Must Have: 9
- Should Have: 10
- Could Have: 8
- Wont Have: 5
```

## Overview

This roadmap takes the Job Application Tracker from a functional single-user kanban tool to a comprehensive, intelligent job search platform. The product already has a solid foundation — CRUD operations, kanban drag-and-drop, SQLite persistence, WebSocket real-time sync, analytics, dark mode, and offline fallback — but significant gaps remain in data integrity, user experience, and the depth of value the product can deliver.

The roadmap is sequenced so that each phase builds on proven capabilities from the previous one. Phase 1 hardens the foundation and fills critical usability gaps. Phase 2 deepens the workflow with features that make the tracker indispensable for daily use. Phase 3 prepares for broader adoption and operational maturity. Phase 4 explores intelligent features and ecosystem expansion.

Competitor context: tools like Huntr, Teal, and Notion-based trackers dominate this space. Huntr offers resume tailoring and job board scraping. Teal provides AI-powered resume matching. Notion templates lack structure and real-time features. The opportunity is a fast, privacy-first, offline-capable tracker that doesn't require a subscription to be useful, while progressively adding intelligence.

---

## Phase 1: Foundation / MVP Hardening

**Purpose**: Close the critical gaps that prevent the product from being reliably used as a daily driver. Right now, the app works but lacks the trust and robustness needed for someone to depend on it during an active job search.

**Why it matters**: A job search is stressful. Users need absolute confidence that their data is safe, that reminders actually fire, and that basic operations like exporting data are available. Without these, the app is a toy — not a tool.

**Target outcome**: A production-ready, trustworthy single-user tracker that someone would choose over a spreadsheet for a real job search.

### Milestone 1.1: Data Trust Baseline

All data operations are validated, backed up, and recoverable. Users can export and import their data without risk.

### Milestone 1.2: Active Reminders & Notifications

Reminder dates become functional — the system alerts users about upcoming follow-ups, interviews, and deadlines.

### Milestone 1.3: Deployable Production Baseline

The app runs reliably with proper error handling, logging, and configuration management.

---

### Feature 1.1: Input Validation & Schema Enforcement

**Description**: Add server-side and client-side validation for all job application fields. Validate required fields (company, role, stage), enforce field length limits, sanitize inputs, and reject malformed payloads with structured error responses.

**Rationale**: The current backend accepts any JSON blob without validation. This means corrupted data, empty records, and injection vectors are all possible. No production application can ship without input validation.

**Priority**: Must  
**Complexity**: Medium  
**Impact**: High  
**Phase**: 1  
**Dependencies**: None  
**Status**: Not started  

**Acceptance criteria**:
- Server rejects payloads missing required fields (company, role, stage) with 400 status and descriptive error
- Field length limits enforced (company ≤ 200 chars, notes ≤ 10000 chars, etc.)
- Client-side form validation shows inline errors before submission
- Existing data is validated on load; malformed records are flagged, not silently dropped

**User stories**:
- As a user, I want clear error messages when I forget to fill in required fields, so I don't create incomplete records.
- As a user, I want confidence that my data is always structurally valid.

**What problem it solves**: Prevents data corruption and silent failures that erode trust.  
**Who benefits**: Every user, especially during high-volume job search activity.  
**Why this phase**: The product cannot be trusted without data integrity. This is the most fundamental gap.  
**Relative importance**: Highest priority in Phase 1 — everything else depends on data being reliable.  
**Sequencing**: No dependencies. Should be implemented first.  
**Success**: Zero malformed records can be created through normal UI interaction or API calls.

---

### Feature 1.2: Data Export & Import

**Description**: Add the ability to export all job application data as JSON and CSV, and import data from JSON files. Export includes all fields, checklist items, contacts, and activity history.

**Rationale**: Users have no way to back up their data, migrate to another tool, or recover from a database failure. This is a dealbreaker for anyone with a serious job search. Competitors like Huntr offer CSV export. This is table stakes.

**Priority**: Must  
**Complexity**: Low  
**Impact**: High  
**Phase**: 1  
**Dependencies**: Feature 1.1 (validation ensures imported data is clean)  
**Status**: Not started  

**Acceptance criteria**:
- "Export" button in settings produces a complete JSON file with all applications and metadata
- CSV export flattens applications into a tabular format suitable for spreadsheets
- JSON import validates data, shows preview of what will be imported, and asks for confirmation
- Import handles duplicates by ID (skip, overwrite, or merge options)

**User stories**:
- As a user, I want to export my data so I have a backup before a major change.
- As a user, I want to import data from a previous export or another tracker.

**What problem it solves**: Data portability and backup — existential for a personal productivity tool.  
**Who benefits**: Every user, especially those with 50+ tracked applications.  
**Why this phase**: No production tool should lock data without an escape hatch. This builds trust.  
**Relative importance**: Second highest in Phase 1 — directly addresses the #1 user anxiety ("what if I lose my data?").  
**Sequencing**: Best implemented after validation (1.1) so imports are guaranteed clean.  
**Success**: A user can export, delete all data, reimport, and have an identical dataset.

---

### Feature 1.3: Active Reminder Notifications

**Description**: Transform the existing reminder date field from passive storage into an active notification system. Show in-app alerts for upcoming and overdue reminders. Display a badge count in the sidebar for pending reminders.

**Rationale**: The app currently stores reminder dates but never acts on them. This is a broken promise in the UI — users set reminders expecting to be reminded, and nothing happens. Competitor tools like Huntr send email reminders; at minimum, we need in-app notification.

**Priority**: Must  
**Complexity**: Medium  
**Impact**: High  
**Phase**: 1  
**Dependencies**: None  
**Status**: Not started  

**Acceptance criteria**:
- A reminder notification panel shows all applications with reminders due today or overdue
- Badge count on sidebar indicates pending reminders
- Reminder cards show company name, role, and days overdue/remaining
- Clicking a reminder opens the application drawer
- Reminders due within 24 hours get visual emphasis (warning color)
- Browser notification API used for background alerts (with user permission)

**User stories**:
- As a user, I want to see which applications need follow-up today without checking each one individually.
- As a user, I want to get a browser notification when a reminder is due so I don't miss it.

**What problem it solves**: The core job search problem of "I forgot to follow up" — the single most common reason people lose opportunities.  
**Who benefits**: Every user who sets reminder dates.  
**Why this phase**: The reminder field already exists. Activating it is high impact with moderate effort and fulfills an existing UI promise.  
**Relative importance**: Critical — this is the feature that makes the tracker more useful than a spreadsheet.  
**Sequencing**: Independent. Can be built in parallel with other Phase 1 work.  
**Success**: A user sets a reminder and is reliably notified both in-app and via browser notification.

---

### Feature 1.4: Normalized Database Schema

**Description**: Migrate from the current JSON blob storage model (`data TEXT` column) to a normalized relational schema with proper columns for each field, plus related tables for checklist items, contacts, and activity history.

**Rationale**: The current schema stores the entire `JobApplication` object as a JSON string in a single column. This prevents SQL-level querying, indexing, sorting, and filtering. It makes future features like search, analytics, and reporting significantly harder to implement. Every competitor with a backend uses a normalized schema.

**Priority**: Must  
**Complexity**: High  
**Impact**: High  
**Phase**: 1  
**Dependencies**: Feature 1.1 (validation defines the canonical schema)  
**Status**: Not started  

**Acceptance criteria**:
- `jobs` table has columns: `id`, `company`, `role`, `stage`, `date`, `salary`, `location`, `work_mode`, `url`, `notes`, `reminder_date`, `created_at`, `updated_at`
- `checklist_items` table with foreign key to `jobs`
- `contacts` table with foreign key to `jobs`
- `activity_log` table with foreign key to `jobs`
- Automated migration script converts existing JSON blob data to new schema
- All API endpoints work unchanged after migration
- Indexes on `stage`, `company`, `created_at` for query performance

**User stories**:
- As a developer, I want to query jobs by stage, date range, or company without parsing JSON.
- As a user, I want the app to stay fast even with hundreds of applications.

**What problem it solves**: Technical debt that blocks every future data-intensive feature.  
**Who benefits**: All users (performance), all developers (maintainability).  
**Why this phase**: This is the infrastructure investment that unblocks Phase 2 and 3 features. Delaying it makes every subsequent feature harder.  
**Relative importance**: High — the only reason it's not #1 is that it's invisible to users. But it's the highest engineering priority.  
**Sequencing**: Depends on validation (1.1) to define canonical field constraints. Must be done before Phase 2 analytics or filtering features.  
**Success**: All existing data is migrated without loss. API contract unchanged. Query performance measurably improved.

---

### Feature 1.5: Structured Error Handling & Logging

**Description**: Replace raw `console.log` with a structured logging framework. Add error handling middleware to the Express server. Return consistent error response shapes. Add client-side error boundaries and retry logic for API calls.

**Rationale**: The current server uses bare `console.log` and minimal try/catch. When something goes wrong, there's no structured way to diagnose it. The frontend silently swallows some errors. For a tool people depend on daily, failures need to be visible and recoverable.

**Priority**: Must  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 1  
**Dependencies**: None  
**Status**: Not started  

**Acceptance criteria**:
- Server uses a structured logger (e.g., pino) with log levels and timestamps
- Express error handling middleware returns consistent `{ error: string, code: string }` responses
- Client shows user-friendly error messages for all API failure modes
- Failed API writes retry up to 3 times with exponential backoff
- WebSocket reconnection has exponential backoff with jitter

**User stories**:
- As a user, I want to see a clear message when something goes wrong, not a silent failure.
- As a developer, I want structured logs to diagnose issues quickly.

**What problem it solves**: Invisible failures and difficult debugging.  
**Who benefits**: Users (visible errors), developers (debuggability).  
**Why this phase**: Production readiness requires observable errors. Shipping without this means shipping blind.  
**Relative importance**: Important but less user-visible than validation or reminders.  
**Sequencing**: Independent. Can be built in parallel.  
**Success**: Every error path produces a structured log entry and a user-visible notification.

---

### Feature 1.6: Configurable Server Settings

**Description**: Replace hardcoded port (24678) and database path (`./jobs.db`) with environment variable configuration. Support `.env` files for local development and environment variables for deployment.

**Priority**: Must  
**Complexity**: Low  
**Impact**: Medium  
**Phase**: 1  
**Dependencies**: None  
**Status**: Not started  

**Acceptance criteria**:
- Server reads `PORT`, `DB_PATH`, and `CORS_ORIGIN` from environment variables
- Defaults preserved for backward compatibility (port 24678, `./jobs.db`, `*`)
- `.env.example` file documents all available configuration
- Frontend API URL configurable via Vite env variables

**User stories**:
- As a developer, I want to run multiple instances on different ports for testing.
- As a user deploying to a server, I want to configure the database path and port.

**What problem it solves**: Deployment flexibility. Currently impossible to configure without code changes.  
**Who benefits**: Anyone deploying or developing the application.  
**Why this phase**: Trivial effort, high deployment value. Blocks any serious deployment.  
**Relative importance**: Low effort, high unlock value.  
**Sequencing**: Independent.  
**Success**: App runs with custom port and database path via environment variables.

---

### Feature 1.7: Component Architecture Refactor

**Description**: Break the monolithic `App.vue` (46KB, ~1200 lines) into focused, single-responsibility components. Extract sidebar, toolbar, search, delete confirmation modal, and state management into separate files. Introduce a composable-based state management pattern (Vue 3 composables).

**Priority**: Should  
**Complexity**: High  
**Impact**: Medium  
**Phase**: 1  
**Dependencies**: None  
**Status**: Not started  

**Acceptance criteria**:
- `App.vue` reduced to <200 lines, acting as layout shell only
- State management extracted to `composables/useJobStore.ts`
- API communication extracted to `composables/useApi.ts`
- Sidebar, Toolbar, SearchBar, DeleteModal extracted as components
- No behavior changes — pure refactor
- All existing functionality verified working after refactor

**User stories**:
- As a developer, I want to find and modify a feature without reading 1200 lines.
- As a contributor, I want components with clear boundaries so I can work on one feature without understanding everything.

**What problem it solves**: Developer velocity and code maintainability. The current monolith makes every change risky.  
**Who benefits**: All developers working on the codebase.  
**Why this phase**: Technical debt that compounds with every new feature. Better to fix before Phase 2 adds more complexity.  
**Relative importance**: Important for velocity but not user-facing. Ranked lower than user-visible features.  
**Sequencing**: Independent but ideally done before Phase 2 feature work begins.  
**Success**: Same functionality, better code organization, faster feature development.

---

### Feature 1.8: Mobile-Responsive Layout

**Description**: Make the application fully usable on mobile devices. The kanban board adapts to a single-column stacked view on narrow screens. The drawer becomes full-screen on mobile. Touch gestures replace drag-and-drop with a stage selector dropdown.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: High  
**Phase**: 1  
**Dependencies**: None  
**Status**: Not started  

**Acceptance criteria**:
- Breakpoints at 768px (tablet) and 480px (mobile)
- Kanban board collapses to vertical card list on mobile with stage tabs
- Drawer opens as full-screen overlay on mobile
- Touch-friendly tap targets (minimum 44x44px)
- Sidebar collapses to hamburger menu on mobile
- All features accessible on mobile — no desktop-only functionality

**User stories**:
- As a user, I want to check my applications on my phone while commuting.
- As a user, I want to quickly update a stage after an interview from my phone.

**What problem it solves**: The app is currently unusable on mobile. Job seekers check their tracker constantly — mobile access is essential.  
**Who benefits**: Every user with a smartphone.  
**Why this phase**: Mobile access is expected for any modern web app. Competing spreadsheet-based trackers are already mobile-friendly.  
**Relative importance**: High impact, addresses a major usability gap.  
**Sequencing**: Independent.  
**Success**: All core workflows (view board, change stage, add application, view details) work smoothly on a 375px-wide screen.

---

### Feature 1.9: Pagination & Performance

**Description**: Add server-side pagination to the `GET /api/jobs` endpoint. Support `?page=1&limit=50&stage=Applied` query parameters. Implement virtual scrolling on the frontend for columns with many cards.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 1  
**Dependencies**: Feature 1.4 (normalized schema enables efficient SQL queries)  
**Status**: Not started  

**Acceptance criteria**:
- `GET /api/jobs` supports `page`, `limit`, `stage`, and `sort` query parameters
- Response includes pagination metadata (`total`, `page`, `pageSize`, `totalPages`)
- Frontend lazily loads cards as user scrolls within a column
- App remains responsive with 500+ applications

**User stories**:
- As a power user tracking 200+ applications, I want the board to load fast and scroll smoothly.

**What problem it solves**: Current architecture loads all data at once. This will degrade as data grows.  
**Who benefits**: Power users with large datasets.  
**Why this phase**: Prevents performance degradation as the user base and data volumes grow.  
**Relative importance**: Lower than core features but important for production readiness.  
**Sequencing**: Requires normalized schema (1.4) for efficient SQL pagination.  
**Success**: Board loads in <1s with 500 applications. Column scrolling stays at 60fps.

---

## Phase 2: Enhancement

**Purpose**: Add features that make the tracker indispensable for daily use — the features that transform it from "a nice tool" to "the tool I can't live without during my job search."

**Why it matters**: Phase 1 makes the product reliable. Phase 2 makes it valuable. These features address the daily friction points of job searching: losing track of documents, forgetting what happened in interviews, not knowing which applications to prioritize.

**Target outcome**: A complete daily-driver job search tool with document management, rich filtering, and a timeline view that provides full context for every interaction.

### Milestone 2.1: Document & File Management

Users can attach resumes, cover letters, and other files to applications, keeping everything organized in one place.

### Milestone 2.2: Smart Filtering & Sorting

Users can slice their application data any way they want — by stage, date, salary range, location, or custom tags.

### Milestone 2.3: Complete Application Context

Every application has a full timeline of events, notes, contacts, and documents so users walk into interviews fully prepared.

---

### Feature 2.1: File Attachments

**Description**: Allow users to attach files (resume, cover letter, portfolio, job description PDF) to each application. Files stored on the server filesystem with metadata in the database. Preview for images and PDFs. Download link for all file types.

**Rationale**: Job seekers typically customize their resume and cover letter for each application. Without a way to attach these, users must manage files separately — defeating the purpose of a centralized tracker. Huntr and Teal both support document storage.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: High  
**Phase**: 2  
**Dependencies**: Feature 1.4 (normalized schema for file metadata storage)  
**Status**: Not started  

**Acceptance criteria**:
- Drag-and-drop file upload in the application drawer
- Supported types: PDF, DOC/DOCX, images, plain text
- File size limit: 10MB per file, 50MB per application
- File list with name, size, type, and upload date
- Preview for PDF and images inline
- Download button for all files
- Delete with confirmation

**User stories**:
- As a user, I want to attach the specific resume I used for each application so I can reference it before an interview.
- As a user, I want to save the job description PDF in case the listing is taken down.

**What problem it solves**: Scattered documents across folders, emails, and cloud storage.  
**Who benefits**: Every active job seeker.  
**Why this phase**: Requires stable storage and schema (Phase 1). Not MVP-critical but transforms the product from a tracker into a hub.  
**Relative importance**: Highest in Phase 2 — most requested feature in competing tools.  
**Sequencing**: Requires normalized schema and file server infrastructure.  
**Success**: A user attaches a resume, closes the app, reopens it, and the file is there with preview.

---

### Feature 2.2: Tags & Labels

**Description**: User-defined tags with color selection that can be applied to any application. Tags are filterable and visible on kanban cards. Examples: "Dream Job", "Referral", "Urgent", "FAANG", "Startup".

**Rationale**: The current stage system is the only way to categorize applications. Users need cross-cutting dimensions — a "Referral" application can be in any stage, a "Dream Job" can be in any stage. Tags provide this without complicating the stage model.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: High  
**Phase**: 2  
**Dependencies**: Feature 1.4 (tags table with many-to-many relationship to jobs)  
**Status**: Not started  

**Acceptance criteria**:
- Create, rename, recolor, and delete tags from a tag management UI
- Apply multiple tags to any application
- Tags visible as colored pills on kanban cards
- Filter board by one or more tags
- Tag filter combinable with search and stage filters

**User stories**:
- As a user, I want to tag applications as "Referral" so I can see all my referred applications in one view.
- As a user, I want to mark applications as "Top Priority" so I know which ones to focus on today.

**What problem it solves**: Flat list of applications with no way to prioritize or categorize beyond stage.  
**Who benefits**: Users with 20+ active applications who need to prioritize.  
**Why this phase**: Requires schema support (Phase 1). Builds on the stable kanban board.  
**Relative importance**: High — directly addresses the "which application should I focus on?" problem.  
**Sequencing**: Depends on normalized schema for the tags junction table.  
**Success**: User creates a "Top 5" tag, applies it to 5 applications, and filters the board to show only those.

---

### Feature 2.3: Column Sorting & Advanced Filtering

**Description**: Sort applications within columns by date, company name, salary, or reminder date. Filter the board by date range, salary range, work mode, location, and tags. Persist filter/sort preferences per session.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 2  
**Dependencies**: Feature 1.4 (normalized schema for efficient SQL sorting/filtering)  
**Status**: Not started  

**Acceptance criteria**:
- Sort dropdown per column: by date (newest/oldest), company (A-Z/Z-A), salary (high/low), reminder date
- Global filter bar with: date range picker, salary range slider, work mode checkboxes, location text filter
- Active filters shown as dismissible chips
- Filter state persisted in URL query parameters for shareability
- Clear all filters button

**User stories**:
- As a user, I want to sort my "Applied" column by date so I see which applications need follow-up.
- As a user, I want to filter by "Remote" work mode to see only remote opportunities.

**What problem it solves**: Large boards become unmanageable without sorting and filtering.  
**Who benefits**: Users with 30+ tracked applications.  
**Why this phase**: Enhances the kanban board after the foundation is solid.  
**Relative importance**: Medium — important for power users but the search feature covers basic needs.  
**Sequencing**: Requires normalized schema for SQL-level sorting.  
**Success**: User filters to "Remote only, applied in last 2 weeks, sorted by salary" and gets instant results.

---

### Feature 2.4: Interview Notes & Prep Templates

**Description**: Structured interview preparation section within each application. Includes: interviewer details, interview format (phone/video/onsite), prep notes template (company research, role questions, STAR stories), and post-interview debrief notes.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: High  
**Phase**: 2  
**Dependencies**: Feature 1.7 (component refactor for clean integration)  
**Status**: Not started  

**Acceptance criteria**:
- "Interview Prep" tab in the application drawer
- Structured fields: interview date/time, interviewer name & role, format, round number
- Prep template with sections: Company Research, Questions to Ask, STAR Stories, Technical Topics
- Post-interview debrief: rating (1-5), notes, next steps, follow-up date
- Multiple interview rounds per application

**User stories**:
- As a user, I want to prepare for each interview round with a structured template so I don't forget important questions.
- As a user, I want to record what happened in each interview so I can improve for the next one.

**What problem it solves**: Interview prep is scattered across docs, notes apps, and memory. Centralizing it reduces anxiety and improves performance.  
**Who benefits**: Users in active interview stages.  
**Why this phase**: Requires stable drawer component and schema support. Adds depth to the core workflow.  
**Relative importance**: High — directly impacts interview success, which is the ultimate goal.  
**Sequencing**: Depends on component refactor for clean integration into the drawer.  
**Success**: User opens an application, sees their prep notes from last round, adds debrief notes, and schedules the next round.

---

### Feature 2.5: Enhanced Analytics Dashboard

**Description**: Upgrade the analytics view with interactive charts, date range filtering, goal tracking, and response time metrics. Add: average days per stage, application-to-interview conversion funnel, weekly/monthly application goals with progress bars.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 2  
**Dependencies**: Feature 1.4 (normalized schema for efficient aggregation queries)  
**Status**: Not started  

**Acceptance criteria**:
- Date range picker for all charts (last 7d, 30d, 90d, all time, custom range)
- Interactive charts with hover tooltips showing exact values
- Average days in each stage metric
- Application-to-interview conversion rate trend line
- Weekly application goal setter with progress bar
- Response rate metric (applications that moved past "Applied" stage)

**User stories**:
- As a user, I want to see my application-to-interview conversion rate so I know if my resume needs improvement.
- As a user, I want to set a weekly application goal and track my progress.

**What problem it solves**: Current analytics are static and informational. Enhanced analytics make them actionable.  
**Who benefits**: Users who want data-driven job search improvement.  
**Why this phase**: Requires normalized schema for efficient aggregation. Builds on Phase 1 analytics.  
**Relative importance**: Medium — valuable for power users and data-driven job seekers.  
**Sequencing**: Depends on normalized schema for SQL aggregation.  
**Success**: User identifies that their resume converts at 10% for remote roles vs 25% for hybrid, and adjusts strategy.

---

### Feature 2.6: Calendar View

**Description**: A calendar view showing interviews, reminder dates, follow-up dates, and application deadlines on a monthly/weekly calendar. Integrates with the existing reminder system.

**Priority**: Could  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 2  
**Dependencies**: Feature 1.3 (active reminders), Feature 2.4 (interview dates)  
**Status**: Not started  

**Acceptance criteria**:
- Monthly and weekly calendar views accessible from sidebar navigation
- Events shown: interview dates, reminder dates, application dates
- Color-coded by event type
- Click event to open application drawer
- Today indicator and current week highlight

**User stories**:
- As a user, I want a calendar view so I can see my upcoming interviews and deadlines at a glance.

**What problem it solves**: Timeline-based view of job search activity that the kanban board doesn't provide.  
**Who benefits**: Users juggling multiple interviews and deadlines.  
**Why this phase**: Requires interview dates and active reminders from earlier features.  
**Relative importance**: Nice to have — the kanban board and reminders cover most needs.  
**Sequencing**: Depends on reminders (1.3) and interview dates (2.4).  
**Success**: User opens calendar, sees 3 interviews next week, clicks one to review prep notes.

---

### Feature 2.7: Bulk Operations

**Description**: Select multiple applications and perform bulk actions: change stage, add/remove tags, delete, export selected. Multi-select via checkboxes on kanban cards or a list view.

**Priority**: Could  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 2  
**Dependencies**: Feature 2.2 (tags for bulk tag operations)  
**Status**: Not started  

**Acceptance criteria**:
- Checkbox on each kanban card for multi-select
- Bulk action bar appears when 2+ cards selected: Move to Stage, Add Tag, Remove Tag, Delete, Export
- Select all within a column
- Confirmation dialog for destructive bulk actions
- Undo support for bulk stage changes

**User stories**:
- As a user, I want to move 10 stale applications to "Rejected" at once instead of one by one.
- As a user, I want to tag all applications from a specific job fair in bulk.

**What problem it solves**: Tedious repetitive operations when managing many applications.  
**Who benefits**: Power users with large boards.  
**Why this phase**: Requires stable CRUD and tag system.  
**Relative importance**: Convenience feature, not critical.  
**Sequencing**: Depends on tags (2.2) for tag-related bulk operations.  
**Success**: User selects 15 old applications, bulk-moves them to Rejected, sees the board update instantly.

---

## Phase 3: Scale / Growth

**Purpose**: Prepare the product for broader adoption with features that support power users, team scenarios, and operational maturity.

**Why it matters**: Phase 2 makes the product great for individual users. Phase 3 makes it viable for career coaches working with clients, job search accountability groups, and users who want to track multiple job searches over time.

**Target outcome**: A robust platform with team support, integrations, and the operational infrastructure needed for sustainable growth.

### Milestone 3.1: Multi-User & Team Readiness

Authentication, user accounts, and optional team sharing are in place.

### Milestone 3.2: External Integrations

The tracker connects to the tools job seekers already use — email, calendars, and job boards.

### Milestone 3.3: Operational Maturity

The platform has monitoring, admin tools, and the infrastructure for reliable operation at scale.

---

### Feature 3.1: User Authentication & Accounts

**Description**: Add user registration, login, and session management. Support email/password and OAuth (Google, GitHub). Each user has their own isolated dataset. JWT-based session tokens with refresh flow.

**Rationale**: Currently the app has no authentication — anyone with network access can read and write all data. This blocks any deployment beyond localhost, any team features, and any cloud hosting.

**Priority**: Must  
**Complexity**: High  
**Impact**: High  
**Phase**: 3  
**Dependencies**: Feature 1.5 (structured error handling for auth errors), Feature 1.6 (configurable settings for auth secrets)  
**Status**: Not started  

**Acceptance criteria**:
- Registration with email/password (hashed with bcrypt)
- Login with JWT access token (15min) and refresh token (7d)
- OAuth login with Google and GitHub
- All API endpoints require authentication
- User data isolation — users can only see their own applications
- Password reset via email link
- Session management UI (active sessions, logout all)

**User stories**:
- As a user, I want to log in so my data is private and accessible from any device.
- As a user, I want to sign in with Google so I don't need another password.

**What problem it solves**: Data security and multi-device access.  
**Who benefits**: Everyone — required for any deployment beyond localhost.  
**Why this phase**: Significant architectural change. Phase 1 and 2 features must stabilize first.  
**Relative importance**: Highest in Phase 3 — unlocks cloud deployment and team features.  
**Sequencing**: Depends on error handling and configuration from Phase 1. Blocks team features (3.2).  
**Success**: Two users can use the same deployed instance with fully isolated data.

---

### Feature 3.2: Team & Sharing

**Description**: Optional team workspaces where a career coach or accountability partner can view (and optionally edit) a user's job board. Role-based access: Owner, Editor, Viewer.

**Priority**: Could  
**Complexity**: High  
**Impact**: Medium  
**Phase**: 3  
**Dependencies**: Feature 3.1 (user authentication)  
**Status**: Not started  

**Acceptance criteria**:
- Create a team workspace and invite members by email
- Role-based access: Owner (full control), Editor (CRUD on applications), Viewer (read-only)
- Shared board view with activity attribution (who changed what)
- Team activity feed
- Leave team and transfer ownership flows

**User stories**:
- As a career coach, I want to see my client's job board so I can provide targeted advice.
- As a user in a job search group, I want to share my board with my accountability partner.

**What problem it solves**: Job searching is often collaborative — coaches, mentors, and accountability partners need visibility.  
**Who benefits**: Career coaches, mentoring relationships, job search groups.  
**Why this phase**: Requires authentication and stable multi-user architecture.  
**Relative importance**: Niche but differentiating — few competitors do this well.  
**Sequencing**: Requires authentication (3.1). Can be a premium feature.  
**Success**: A coach views a client's board, leaves a comment, and the client sees it.

---

### Feature 3.3: Email Integration

**Description**: Connect email (Gmail, Outlook) to automatically detect job-related emails and link them to applications. Auto-detect application confirmations, interview invitations, and rejections. Suggest stage changes based on email content.

**Priority**: Could  
**Complexity**: High  
**Impact**: High  
**Phase**: 3  
**Dependencies**: Feature 3.1 (authentication for OAuth email access)  
**Status**: Not started  

**Acceptance criteria**:
- OAuth connection to Gmail and Outlook
- Email scanning for job-related patterns (confirmation, interview invite, rejection)
- Matched emails linked to applications by company name
- Suggested stage changes presented as actionable notifications
- User confirms or dismisses suggestions — never auto-applies
- Email content never stored on server — only metadata and links

**User stories**:
- As a user, I want the tracker to notice when I receive an interview invitation and suggest updating the stage.
- As a user, I want to see all emails related to an application in one place.

**What problem it solves**: Manual stage updates are tedious and often forgotten. Email is where most job search communication happens.  
**Who benefits**: High-volume job seekers.  
**Why this phase**: Requires authentication, stable data model, and significant integration work.  
**Relative importance**: High impact but high complexity. Justifiable only after core product is mature.  
**Sequencing**: Requires authentication for OAuth. Depends on stable schema for reliable matching.  
**Success**: User receives interview email, app suggests "Move to Interview stage?", user confirms with one click.

---

### Feature 3.4: Calendar Sync (Google Calendar / Outlook)

**Description**: Two-way sync between the tracker's interview dates and external calendars. Interviews added in the tracker appear in Google Calendar and vice versa.

**Priority**: Could  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 3  
**Dependencies**: Feature 3.1 (authentication), Feature 2.4 (interview dates), Feature 2.6 (calendar view)  
**Status**: Not started  

**Acceptance criteria**:
- OAuth connection to Google Calendar and Outlook Calendar
- Interviews created in tracker appear in external calendar with company, role, and format
- External calendar events tagged as interviews appear in tracker's calendar view
- Two-way sync with conflict resolution (last-write-wins with notification)
- Sync status indicator and manual refresh button

**User stories**:
- As a user, I want my interviews to appear in my Google Calendar so I don't double-book.

**What problem it solves**: Manually copying interview times between the tracker and calendar.  
**Who benefits**: Users managing multiple interviews per week.  
**Why this phase**: Requires OAuth infrastructure, calendar view, and interview data structures.  
**Relative importance**: Medium — convenience feature for active interviewers.  
**Sequencing**: Requires authentication (3.1), interview dates (2.4), calendar view (2.6).  
**Success**: User adds interview date in tracker, it appears in Google Calendar within 30 seconds.

---

### Feature 3.5: API Rate Limiting & Security Hardening

**Description**: Add rate limiting to all API endpoints. Implement CSRF protection, request size limits, and security headers. Add API key support for programmatic access.

**Priority**: Must  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 3  
**Dependencies**: Feature 3.1 (authentication)  
**Status**: Not started  

**Acceptance criteria**:
- Rate limiting: 100 requests/minute per user, 10 writes/minute per user
- CSRF token validation on state-changing requests
- Request body size limit: 1MB
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options
- API key generation for programmatic access
- Audit log for authentication events

**User stories**:
- As a platform operator, I want rate limiting so one user can't degrade service for others.
- As a developer, I want an API key to build custom integrations.

**What problem it solves**: Security vulnerabilities and abuse vectors in a multi-user environment.  
**Who benefits**: All users (security), developers (API access).  
**Why this phase**: Only relevant after authentication is in place.  
**Relative importance**: Required for any public deployment.  
**Sequencing**: Requires authentication (3.1).  
**Success**: Automated security scan shows no critical vulnerabilities. API keys work for custom integrations.

---

### Feature 3.6: Observability & Monitoring

**Description**: Add application monitoring with health checks, uptime tracking, error rate dashboards, and alerting. Instrument key operations with timing metrics.

**Priority**: Should  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 3  
**Dependencies**: Feature 1.5 (structured logging)  
**Status**: Not started  

**Acceptance criteria**:
- `GET /health` endpoint returning server status, uptime, and database connectivity
- Key metrics tracked: request latency p50/p95/p99, error rate, active WebSocket connections
- Structured logs compatible with log aggregation tools (JSON format)
- Error alerting via webhook (Slack, Discord, email)
- Admin dashboard showing system health (optional)

**User stories**:
- As an operator, I want to know when the server has errors so I can fix them before users notice.
- As a developer, I want latency metrics to identify performance regressions.

**What problem it solves**: Blind operation — currently no way to know if the server is healthy.  
**Who benefits**: Operators and developers.  
**Why this phase**: Only necessary when operating for multiple users.  
**Relative importance**: Operational hygiene. Essential for reliability at scale.  
**Sequencing**: Builds on structured logging (1.5).  
**Success**: Alert fires within 60 seconds of a sustained error rate spike.

---

### Feature 3.7: Job Board Scraping & Auto-Fill

**Description**: Browser extension or bookmarklet that captures job posting details from major job boards (LinkedIn, Indeed, Glassdoor) and pre-fills the new application form.

**Priority**: Should  
**Complexity**: High  
**Impact**: High  
**Phase**: 3  
**Dependencies**: Feature 1.1 (validation for scraped data), Feature 3.1 (authentication for extension auth)  
**Status**: Not started  

**Acceptance criteria**:
- Browser extension for Chrome and Firefox
- Auto-detects job posting pages on LinkedIn, Indeed, Glassdoor, and company career pages
- Extracts: company name, job title, location, salary (if listed), work mode, URL
- One-click "Save to Tracker" button adds to pipeline in "Applied" stage
- Extension authenticates with the tracker via API key
- Manual correction available before saving

**User stories**:
- As a user, I want to save a job posting to my tracker with one click instead of manually copying every field.

**What problem it solves**: Manual data entry is the biggest friction point in using a tracker. Most people stop tracking because it's too tedious.  
**Who benefits**: Every active job seeker.  
**Why this phase**: Requires stable API, authentication, and validation. Significant cross-platform development effort.  
**Relative importance**: Potentially the highest-impact feature in the entire roadmap — but also highest complexity.  
**Sequencing**: Requires authentication (3.1) and validation (1.1). Can be developed in parallel with other Phase 3 work.  
**Success**: User clicks "Save to Tracker" on a LinkedIn job posting, switches to the app, and sees the pre-filled card.

---

## Phase 4: Future / Vision

**Purpose**: Long-term bets on intelligence, automation, and ecosystem expansion that only make sense after the product foundation, workflow depth, and growth infrastructure are stable.

**Why it matters**: These features represent the product's moat — the capabilities that would make a user unwilling to switch to a competitor. They require significant data, infrastructure, and user trust that only Phases 1-3 can build.

**Target outcome**: An AI-augmented job search assistant that proactively helps users improve their applications, prepare for interviews, and make strategic decisions about their job search.

### Milestone 4.1: Intelligent Assistance

AI-powered features that provide actionable job search advice based on the user's data.

### Milestone 4.2: Ecosystem Expansion

The tracker becomes a platform with an API, integrations marketplace, and cross-platform presence.

---

### Feature 4.1: AI Resume Tailoring Suggestions

**Description**: Analyze the job description (from URL or attached PDF) and the user's uploaded resume. Provide specific suggestions for keywords, skills, and experience phrasing that would improve match rate. Highlight gaps between resume and job requirements.

**Priority**: Could  
**Complexity**: High  
**Impact**: High  
**Phase**: 4  
**Dependencies**: Feature 2.1 (file attachments for resume storage), Feature 3.7 (job description capture)  
**Status**: Not started  

**Acceptance criteria**:
- Side-by-side view: job description keywords vs. resume content
- Highlighted missing keywords with suggestions for incorporation
- Match score (percentage of key requirements addressed)
- Suggestions are actionable ("Add 'React' to your skills section — the JD mentions it 3 times")
- Works with PDF and DOCX resumes
- Privacy: analysis runs locally or with explicit user consent for cloud processing

**User stories**:
- As a user, I want to know if my resume matches the job description before I apply.
- As a user, I want specific suggestions for improving my resume for each application.

**What problem it solves**: Resume-job description mismatch is the #1 reason applications are filtered out by ATS systems.  
**Who benefits**: Every job applicant.  
**Why this phase**: Requires file attachments (Phase 2), job descriptions (Phase 3), and significant AI/NLP development.  
**Relative importance**: Potentially transformative but requires heavy investment. Only viable after the product has a strong user base.  
**Sequencing**: Depends on file attachments (2.1) and job description capture (3.7).  
**Success**: User uploads resume, AI highlights 5 missing keywords, user adds them, match score increases from 62% to 88%.

---

### Feature 4.2: Smart Stage Predictions

**Description**: Based on the user's historical data, predict likely outcomes for active applications. Show probability of advancing to next stage based on company response patterns, time in current stage, and overall conversion rates.

**Priority**: Could  
**Complexity**: High  
**Impact**: Medium  
**Phase**: 4  
**Dependencies**: Feature 2.5 (enhanced analytics with conversion data), sufficient historical data  
**Status**: Not started  

**Acceptance criteria**:
- Probability indicator on each application card (e.g., "72% likely to advance")
- Based on: days in current stage vs. historical average, company response patterns, stage conversion rates
- Confidence level based on data volume
- "Stale application" warning when an application has been in a stage longer than 2x the average

**User stories**:
- As a user, I want to know which applications are likely to progress so I can focus my energy.
- As a user, I want a warning when an application has gone silent for too long.

**What problem it solves**: Uncertainty about which applications to invest energy in.  
**Who benefits**: Users with 20+ active applications who need to prioritize.  
**Why this phase**: Requires sufficient historical data and analytics infrastructure from earlier phases.  
**Relative importance**: Interesting but speculative. Value depends on data quality and volume.  
**Sequencing**: Requires enhanced analytics (2.5) and significant historical data.  
**Success**: Predictions align with actual outcomes within 20% accuracy for users with 50+ completed applications.

---

### Feature 4.3: Interview Coach

**Description**: AI-powered interview preparation that generates company-specific questions, suggests STAR-format answers based on the user's notes, and provides mock interview practice with feedback.

**Priority**: Wont  
**Complexity**: High  
**Impact**: High  
**Phase**: 4  
**Dependencies**: Feature 2.4 (interview prep), Feature 4.1 (AI infrastructure)  
**Status**: Not started — deferred  

**Acceptance criteria**:
- Generate company-specific interview questions based on role, company, and industry
- Suggest STAR-format answer outlines based on user's experience notes
- Optional: interactive mock interview with text-based Q&A
- Feedback on answer quality (too vague, missing metrics, etc.)

**Why deferred**: This requires significant AI/ML investment, external API dependencies, and extensive testing. The ROI is unclear until the user base is large enough to justify the development cost. Better to validate demand through the simpler interview prep templates (2.4) first.

---

### Feature 4.4: Public API & Webhooks

**Description**: Documented REST API with API key authentication, rate limiting, and webhook support for external integrations. Developers can build custom integrations, automations, and reporting tools.

**Priority**: Wont  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 4  
**Dependencies**: Feature 3.1 (authentication), Feature 3.5 (API security)  
**Status**: Not started — deferred  

**Acceptance criteria**:
- OpenAPI/Swagger documentation for all endpoints
- API key management in user settings
- Webhook configuration: URL, events, secret for signature verification
- Webhook events: application.created, application.updated, application.stage_changed, application.deleted
- Rate limiting per API key

**Why deferred**: The product needs to reach a scale where third-party integrations have meaningful demand. Building API infrastructure too early is overengineering. The internal API (used by the frontend) should stabilize first.

---

### Feature 4.5: Native Mobile App (PWA)

**Description**: Convert the web app to a Progressive Web App (PWA) with offline support, push notifications, and home screen installation. Full offline CRUD with background sync when connectivity is restored.

**Priority**: Wont  
**Complexity**: High  
**Impact**: High  
**Phase**: 4  
**Dependencies**: Feature 1.8 (mobile-responsive layout), Feature 1.3 (reminders for push notifications)  
**Status**: Not started — deferred  

**Acceptance criteria**:
- Service worker with offline caching strategy
- Full offline CRUD with IndexedDB local storage
- Background sync queue for offline changes
- Push notifications for reminders and stage changes
- Installable from browser (Add to Home Screen)
- App-like navigation with no browser chrome

**Why deferred**: The mobile-responsive layout (1.8) provides mobile access without the PWA complexity. PWA investment is justified only after mobile usage data confirms demand. The offline fallback to localStorage already provides basic offline support.

---

### Feature 4.6: Salary Intelligence & Market Data

**Description**: Aggregate anonymized salary data across users to provide market rate context. Show salary ranges for similar roles and locations. Compare the user's offers against market benchmarks.

**Priority**: Wont  
**Complexity**: High  
**Impact**: Medium  
**Phase**: 4  
**Dependencies**: Feature 3.1 (multi-user for data aggregation), significant user base  
**Status**: Not started — deferred  

**Acceptance criteria**:
- Market salary range shown alongside user-entered salary for matching roles
- Data sourced from aggregated, anonymized user data and/or public APIs
- Comparison visualization: user's salary vs. market 25th/50th/75th percentile
- Location and experience-level adjustments

**Why deferred**: Requires a large user base for meaningful data aggregation. Privacy concerns need careful handling. Public salary APIs (Glassdoor, Levels.fyi) could provide interim data, but integration adds complexity. Better to focus on core workflow first.

---

### Feature 4.7: Multi-Search Campaigns

**Description**: Support multiple independent job searches within one account. Each search has its own board, analytics, and history. Useful for exploring different career directions, annual job market testing, or separating active and passive searches.

**Priority**: Wont  
**Complexity**: Medium  
**Impact**: Medium  
**Phase**: 4  
**Dependencies**: Feature 3.1 (user accounts)  
**Status**: Not started — deferred  

**Acceptance criteria**:
- Create, rename, and archive search campaigns
- Each campaign has isolated applications, analytics, and tags
- Quick switcher between campaigns
- Cross-campaign analytics (optional)
- Archive completed searches with read-only access

**Why deferred**: Most users run one search at a time. Multi-campaign is a power feature for career-switchers and passive seekers. Building it before the single-campaign experience is polished would be premature optimization.
