# Software Requirements Specification — TopicMatrix

**Project:** TopicMatrix — Subject Mastery & Study Competency Tracking System
**Version:** 1.0 (draft)
**Date:** 2026-09-05
**Source:** Derived from `documents/planning/initial.txt` plus clarification decisions recorded in §14.

---

## 1. Executive Summary

TopicMatrix is a self-hosted, responsive web application that lets a learner break a subject down into a tree of topics, log the outcome of study/quiz sessions against those topics, and be told **what to revise and when**. Scheduling is driven by a spaced-repetition algorithm (FSRS by default) operating at **topic level**, informed by both objective accuracy and self-reported confidence.

The product is deliberately *not* a flashcard app. It does not store question content or run quizzes. It is a **tracking and scheduling layer** that sits on top of study the user does elsewhere — past papers, textbooks, question banks, lectures.

### 1.1 Problem statement

Learners working through past papers and question banks have no reliable way to answer:

- Which topics am I actually weak at, versus which ones merely *feel* uncomfortable?
- Which topics have I not touched in long enough that I have probably forgotten them?
- What should I revise today?

Accuracy alone is misleading (a lucky guess looks like mastery), and confidence alone is misleading (overconfidence is common). TopicMatrix combines both, decays them over time, and turns the result into a concrete daily queue.

### 1.2 Goals

| # | Goal | Success measure |
|---|---|---|
| G1 | Structure any subject into an arbitrarily deep topic tree | User can model a full syllabus without hitting structural limits |
| G2 | Make logging a study session take under 20 seconds | Median time from "log session" click to save |
| G3 | Produce a trustworthy daily review queue | Queue is non-empty and correctly ordered whenever due items exist |
| G4 | Surface weakness honestly | Competency score reflects accuracy, confidence *and* recency |
| G5 | Run on a developer laptop (SQLite) or a server (PostgreSQL) with no code changes | Same test suite passes against both providers, run locally on plain Node |
| G6 | Deploy either as a self-hosted container or to Cloudflare Workers, from one codebase | Both targets build and pass the same E2E suite in CI |

### 1.3 Non-goals for v1

Explicitly out of scope — see §12 for the full list: flashcards, question content storage, in-app quiz taking, mobile native apps, email/push notifications, sharing or collaboration, AI-generated content.

---

## 2. Users & Personas

### 2.1 Learner (primary)

A student or professional preparing for an exam. Owns subjects, topics and study sessions. Sees only their own data. Typical session: open dashboard → see 4 topics due → study one elsewhere → log the result → next review date is recalculated.

### 2.2 Administrator

A learner account with elevated privileges. In a self-hosted single-instance deployment this is normally the person who runs the server. Can create, disable and delete user accounts and trigger password resets. **Cannot** read another user's study data.

### 2.3 System (automated)

Non-interactive processes: computing competency scores, computing next review dates, promoting items into the overdue bucket as time passes, and maintaining streak counters.

---

## 3. Definitions

| Term | Meaning |
|---|---|
| **Subject** | Top-level container, e.g. *Organic Chemistry*. Owned by exactly one user. |
| **Topic** | A node in a tree beneath a Subject. May have children to unlimited depth. |
| **Study Session** | A dated record of a block of practice logged against one Topic. |
| **Confidence** | Self-reported 1–5 rating attached to a Study Session. |
| **Accuracy** | `questionsCorrect / questionsAttempted` for a session. |
| **Competency Score** | Derived 0–100 value per topic. See §7. |
| **Review Schedule** | Per-topic state: last reviewed, next due date, interval, algorithm memory state. |
| **Review Queue** | Ordered list of topics due on or before today. |
| **Health Status** | 🟢 Strong / 🟡 Needs review / 🔴 At risk. Derived. See §7.4. |
| **Progress Status** | Not Started / In Progress / Needs Review / Mastered. Derived. See §7.5. |

---

## 4. System Context

```mermaid
graph LR
  U[Learner<br/>browser] -->|HTTPS / REST + JWT| API[HTTP API<br/>Hono + TypeScript]
  A[Administrator<br/>browser] -->|HTTPS / REST + JWT| API
  API --> SCHED[Scheduler<br/>FSRS / SM-2 / Manual]
  API --> SCORE[Competency<br/>scoring engine]
  API --> ORM[Prisma<br/>+ driver adapter]
  ORM --> PG[(PostgreSQL<br/>self-hosted prod)]
  ORM --> SL[(SQLite<br/>local dev)]
  ORM --> D1[(Cloudflare D1<br/>Workers prod)]
  ORM -.-> HD[(PostgreSQL via<br/>Hyperdrive)]
```

Single logical deployable: a React SPA served as static assets, plus a JSON API. No external services and no third-party network calls at runtime. The same API code runs on a Node.js server (self-hosted) or on the Cloudflare Workers runtime — see §14.

**Runtime adapters.** The API is written against Web-standard `Request`/`Response` and is mounted by a thin per-target entrypoint. The only target-specific code is that entrypoint plus the database adapter selection.

---

## 5. Functional Requirements

Priority key: **M** = Must have (v1), **S** = Should have (v1 if time allows), **C** = Could have (post-v1).

### 5.1 Authentication & Accounts

| ID | Requirement | Pri |
|---|---|---|
| FR-1.1 | The system shall authenticate users with email address and password. | M |
| FR-1.2 | Passwords shall be hashed with Argon2id (fallback bcrypt cost ≥ 12). Plaintext or reversible storage is prohibited. | M |
| FR-1.3 | Successful login shall return a short-lived access token (JWT, 15 min) and a long-lived refresh token (30 days) stored in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. | M |
| FR-1.4 | Public self-registration shall **not** be available. Accounts are created by an administrator only. | M |
| FR-1.5 | An administrator shall be able to list, create, disable, re-enable and delete user accounts, and set a user's role (`LEARNER` \| `ADMIN`). | M |
| FR-1.6 | On account creation the administrator sets a temporary password; the user shall be forced to change it at first login. | M |
| FR-1.7 | A user shall be able to change their own password by supplying their current password. | M |
| FR-1.8 | Deleting a user shall cascade-delete all of that user's subjects, topics, sessions and schedules, after an explicit typed confirmation. | M |
| FR-1.9 | The first user shall be created by a one-time seed/CLI command (`npm run seed:admin`), not through the UI. | M |
| FR-1.10 | Login attempts shall be rate-limited to 10 per 15 minutes per IP and per email address. The client IP is taken from the runtime's trusted source (`CF-Connecting-IP` on Workers, the configured trusted-proxy header on Node) and never from an unvalidated `X-Forwarded-For`. | M |
| FR-1.11 | Refresh tokens shall be revocable; logout invalidates the presented refresh token server-side. | S |

### 5.2 Subject Management

| ID | Requirement | Pri |
|---|---|---|
| FR-2.1 | A user shall be able to create a Subject with a name (1–120 chars, required), optional description, optional colour and optional icon. | M |
| FR-2.2 | Subject names shall be unique per user, case-insensitively. | M |
| FR-2.3 | A user shall be able to rename, edit and archive a Subject. Archived subjects are hidden from the dashboard and generate no review items but retain all data. | M |
| FR-2.4 | Deleting a Subject shall require typed confirmation and shall cascade-delete its topics, sessions and schedules. | M |
| FR-2.5 | The subject list shall display, per subject: topic count, aggregate competency score, number of topics due today, and last activity date. | M |
| FR-2.6 | A user shall be able to reorder subjects manually. | C |

### 5.3 Topic Hierarchy

| ID | Requirement | Pri |
|---|---|---|
| FR-3.1 | A Topic shall belong to exactly one Subject and may have one optional parent Topic within the same Subject. | M |
| FR-3.2 | Nesting depth shall be unlimited. A soft warning is shown beyond depth 6. | M |
| FR-3.3 | Topic names shall be unique among siblings, case-insensitively. | M |
| FR-3.4 | The system shall prevent cycles; a topic may not be moved beneath itself or one of its descendants. | M |
| FR-3.5 | A user shall be able to create, rename, edit notes on, move (re-parent, including to another Subject), reorder and delete Topics. | M |
| FR-3.6 | Deleting a Topic shall offer two options: delete the whole subtree, or promote children to the deleted topic's parent. | M |
| FR-3.7 | Study sessions shall be loggable against a Topic at **any** depth, including non-leaf topics. | M |
| FR-3.8 | Metrics shall roll up: a parent topic's aggregate metrics combine its own sessions with those of all descendants, weighted by questions attempted. A topic's **own** metrics remain separately visible. | M |
| FR-3.9 | A user shall be able to apply free-form tags to topics and filter by tag across subjects. | S |
| FR-3.10 | The topic tree shall support drag-and-drop reordering and re-parenting, keyboard navigation, and expand/collapse with persisted state. | S |
| FR-3.11 | A user shall be able to bulk-create a topic tree by pasting indented text. | C |

### 5.4 Study Session Logging

| ID | Requirement | Pri |
|---|---|---|
| FR-4.1 | A user shall be able to log a Study Session against a Topic capturing: date (required, defaults to today, may not be in the future); source/year label (optional free text, e.g. "2019 Paper 2"); questions attempted (required, integer ≥ 1); questions correct (required, integer ≥ 0 and ≤ attempted); confidence 1–5 (required); duration in minutes (optional, integer ≥ 0); notes (optional). | M |
| FR-4.2 | Accuracy shall be computed and stored on save, not entered by the user. | M |
| FR-4.3 | Saving a session shall immediately recalculate the topic's competency score and next review date, and mark the topic as reviewed on that date. | M |
| FR-4.4 | A user shall be able to edit and delete past sessions; both actions shall trigger a full recalculation of that topic's score and schedule. | M |
| FR-4.5 | The session form shall present confidence as a labelled 1–5 scale: 1 Guessing · 2 Somewhat know it · 3 Mostly know it · 4 Strong understanding · 5 Expert level confidence. | M |
| FR-4.6 | A topic shall display its session history in a sortable, paginated table. | M |
| FR-4.7 | Back-dated sessions shall be accepted; the schedule shall be recomputed chronologically so that history rebuilds correctly. | M |
| FR-4.8 | The system shall support logging a session against multiple topics at once, splitting question counts per topic. | C |

### 5.5 Scheduling

| ID | Requirement | Pri |
|---|---|---|
| FR-5.1 | Each Topic shall have exactly one Review Schedule record, created lazily on first session. | M |
| FR-5.2 | The system shall support three scheduling modes per topic: `FSRS` (default), `SM2`, and `MANUAL`. | M |
| FR-5.3 | The default mode shall be configurable at user level and overridable per subject and per topic; the most specific setting wins. | M |
| FR-5.4 | Session outcome shall be mapped to an algorithm grade using accuracy and confidence — see §8.1. The computed grade shall be shown to the user before saving, with the option to override it. | M |
| FR-5.5 | `MANUAL` mode shall use a user-defined ordered interval ladder, defaulting to 1, 3, 7, 14, 30, 60 days. A passing grade advances one rung; a failing grade resets to the first rung. | M |
| FR-5.6 | A user shall be able to override the next review date for any topic directly, and to snooze a topic by *n* days. | M |
| FR-5.7 | Changing algorithm on a topic with existing history shall re-derive the schedule from that history and warn the user that dates will change. | M |
| FR-5.8 | Scheduling shall be pure and deterministic: same inputs → same outputs, and shall be implemented behind a `Scheduler` interface so further algorithms can be added without touching call sites. | M |
| FR-5.9 | Due-date computation shall use the user's configured IANA timezone and a configurable "day start hour" (default 04:00) so late-night study counts toward the previous day. | M |
| FR-5.10 | A topic shall be suspendable — retained with history but excluded from the review queue. | S |
| FR-5.11 | The system shall support a daily maximum number of review items, deferring the lowest-priority overflow. | C |

### 5.6 Study Session Launcher

| ID | Requirement | Pri |
|---|---|---|
| FR-6.1 | A user shall be able to launch a review session filtered by: a specific Subject; a specific Topic and its descendants; **Due today** (all overdue and due topics); or **Weakest topics** (lowest competency score first). | M |
| FR-6.2 | Additional filters: tag, health status, "not reviewed in *n* days", and minimum/maximum competency score. | S |
| FR-6.3 | A launched session shall present topics one at a time with name, notes, last score, accuracy trend and next-due date, with actions: log result, skip, snooze. | M |
| FR-6.4 | A user shall be able to cap a launched session by item count or by target minutes. | S |
| FR-6.5 | Session progress shall survive a page refresh. | S |

### 5.7 Dashboard & Analytics

| ID | Requirement | Pri |
|---|---|---|
| FR-7.1 | The dashboard shall show a **Review Queue** split into Overdue, Due today, and Due in the next 7 days, ordered by overdue days descending then competency score ascending. | M |
| FR-7.2 | The dashboard shall show today's activity summary: topics reviewed, questions attempted, overall accuracy, minutes studied. | M |
| FR-7.3 | The dashboard shall show a **streak counter** (consecutive days with ≥ 1 logged session, in the user's timezone) plus longest streak, and an activity calendar heatmap for the last 12 months. | M |
| FR-7.4 | A **Mastery chart** shall show competency score per topic within a subject as a horizontal bar chart, sortable by score or name. | M |
| FR-7.5 | A **Topic Heatmap** shall render the topic tree as a colour-coded grid keyed on competency score, with a distinct treatment for *neglected* topics (no session in ≥ 30 days) and *never started* topics. | M |
| FR-7.6 | A **Topic Health View** shall list, for every topic: competency score, last reviewed, next review date, accuracy %, confidence % (`(avgConfidence − 1) / 4`), review trend (▲ ▼ ▬ from the difference between the last two competency snapshots), and health status. It shall be sortable and filterable on every column. | M |
| FR-7.7 | A **Knowledge Retention Curve** shall plot, for a selected topic or subject, the competency score over time as a line, with review events marked, and the modelled decay between reviews shown as a dashed projection — making forgetting and post-review recovery visible. | M |
| FR-7.8 | An **Accuracy over time** chart shall plot per-session accuracy and confidence on a shared time axis to expose calibration gaps between the two. | S |
| FR-7.9 | Analytics shall support date-range selection (30 / 90 / 365 days / all time). | S |
| FR-7.10 | A competency snapshot shall be persisted per topic whenever the score changes, so historical curves do not have to be recomputed from raw sessions on every request. | M |

### 5.8 Settings

| ID | Requirement | Pri |
|---|---|---|
| FR-8.1 | Users shall be able to set: display name, IANA timezone, day start hour, default scheduling algorithm, manual interval ladder, and neglect threshold in days. | M |
| FR-8.2 | Users shall be able to tune competency scoring weights and health thresholds, with a reset-to-defaults action. | S |
| FR-8.3 | Light and dark themes shall be supported, following the OS preference by default. | S |

### 5.9 Data Portability

| ID | Requirement | Pri |
|---|---|---|
| FR-9.1 | A user shall be able to export all of their own data as a single JSON document (subjects, topics, sessions, schedules, settings). | M |
| FR-9.2 | A user shall be able to export study sessions as CSV, optionally filtered by subject and date range. | M |
| FR-9.3 | Import is out of scope for v1. The JSON export shall nonetheless be versioned and lossless so that an importer can be added later without data loss. | M |

---

## 6. Data Model

```mermaid
erDiagram
  USER ||--o{ SUBJECT : owns
  USER ||--|| USER_SETTINGS : has
  USER ||--o{ REFRESH_TOKEN : has
  SUBJECT ||--o{ TOPIC : contains
  TOPIC ||--o{ TOPIC : "parent of"
  TOPIC ||--o{ STUDY_SESSION : "logged against"
  TOPIC ||--o| REVIEW_SCHEDULE : has
  TOPIC ||--o{ COMPETENCY_SNAPSHOT : has
  TOPIC }o--o{ TAG : "tagged with"
```

### 6.1 Entities

**User** — `id`, `email` (unique, stored lower-cased), `passwordHash`, `displayName`, `role`, `isActive`, `mustChangePassword`, `createdAt`, `updatedAt`.

**UserSettings** — `userId` (unique), `timezone` (default `Europe/London`), `dayStartHour` (default 4), `defaultAlgorithm`, `manualIntervalsJson` (default `[1,3,7,14,30,60]`), `neglectThresholdDays` (default 30), `weightAccuracy` (0.60), `weightConfidence` (0.25), `weightRecency` (0.15), `strongThreshold` (75), `needsReviewThreshold` (50), `theme`.

**Subject** — `id`, `userId`, `name`, `description`, `colour`, `icon`, `sortOrder`, `isArchived`, `defaultAlgorithm` (nullable override), timestamps.

**Topic** — `id`, `subjectId`, `parentId` (nullable), `name`, `notes`, `sortOrder`, `depth` (denormalised), `path` (denormalised materialised path, e.g. `/a1/b7/c2/`, for subtree queries), `algorithmOverride` (nullable), `isSuspended`, timestamps.

**StudySession** — `id`, `topicId`, `userId` (denormalised for query scoping), `studiedOn` (date), `sourceLabel`, `questionsAttempted`, `questionsCorrect`, `accuracy` (0–1, computed), `confidence` (1–5), `durationMinutes` (nullable), `notes`, `gradeUsed`, `createdAt`, `updatedAt`.

**ReviewSchedule** — `topicId` (unique), `algorithm`, `lastReviewedOn`, `nextReviewOn`, `intervalDays`, `repetitions`, `lapses`, `easeFactor` (SM-2), `stability` / `difficulty` (FSRS), `manualLadderIndex`, `isSuspended`, `updatedAt`.

**CompetencySnapshot** — `id`, `topicId`, `capturedOn`, `score` (0–100), `accuracyComponent`, `confidenceComponent`, `recencyComponent`, `triggeredBySessionId` (nullable).

**Tag** — `id`, `userId`, `name` (unique per user). **TopicTag** — join table.

**RefreshToken** — `id`, `userId`, `tokenHash`, `expiresAt`, `revokedAt`, `createdAt`.

### 6.2 Indexes

`Subject(userId, isArchived)`; `Topic(subjectId, parentId)`; `Topic(path)`; `StudySession(topicId, studiedOn DESC)`; `StudySession(userId, studiedOn DESC)`; `ReviewSchedule(nextReviewOn)`; `CompetencySnapshot(topicId, capturedOn DESC)`.

### 6.3 Multi-provider constraints (PostgreSQL + SQLite + Cloudflare D1)

These are hard constraints on the schema, driven by NF-5. D1 is SQLite-dialect, so it inherits every SQLite constraint below plus the additional limits in §14.4.

- **No Prisma `enum` types** — SQLite does not support them. Use `String` columns with TypeScript union types and runtime validation (Zod) at the boundary.
- **No `Json` columns** — store JSON as `String` (`TEXT`) and parse in the repository layer. Affects `manualIntervalsJson`.
- **No native database attributes** (`@db.VarChar`, `@db.Uuid`, `@db.Decimal`) — they do not resolve across providers.
- **No `Decimal`** — use `Float` for accuracy and scores, `Int` for counts.
- **No arrays, no full-text search, no `citext`** — case-insensitive uniqueness is enforced by storing a normalised lower-case column alongside the display value, because Prisma's `mode: 'insensitive'` is PostgreSQL-only.
- **Dates**: store timestamps in UTC. Date-only fields (`studiedOn`, `nextReviewOn`) are stored as UTC midnight and interpreted using the user's timezone in the application layer. Never rely on database date functions.
- **Provider selection**: schema files (`prisma/schema.postgres.prisma`, `prisma/schema.sqlite.prisma`, `prisma/schema.d1.prisma`) generated from one shared model fragment by a build script, selected by the `DATABASE_PROVIDER` environment variable. Prisma does not support an environment variable for `datasource.provider`, so this is generated rather than configured.
- **Migrations**: maintained per provider. CI runs the full integration suite against all three. D1 migrations are applied with `wrangler d1 migrations apply` using SQL generated by `prisma migrate diff`.
- **No interactive transactions on D1** — D1 supports batched statements but not long-lived interactive transactions. Multi-step writes must be expressible as a single batch or be made idempotent and retry-safe. This is the sharpest schema-level consequence of supporting Workers; see §14.4.

---

## 7. Competency Scoring

### 7.1 Formula

For a topic, over its sessions $s_1 \dots s_n$ ordered by date (most recent first):

$$
\text{Score} = 100 \times \left( w_a \cdot A + w_c \cdot C + w_r \cdot R \right)
$$

with defaults $w_a = 0.60$, $w_c = 0.25$, $w_r = 0.15$ (must sum to 1.0; user-tunable per FR-8.2).

**Recency weight** for session $i$, studied $d_i$ days ago, with half-life $H = 30$ days:

$$
w_i = 0.5^{\,d_i / H}
$$

**Accuracy component** — recency-weighted, question-count-weighted accuracy:

$$
A = \frac{\sum_i w_i \cdot q_i \cdot a_i}{\sum_i w_i \cdot q_i}
$$

where $q_i$ is questions attempted and $a_i$ is accuracy. Weighting by $q_i$ prevents a 2-question session from carrying the same authority as a 50-question one.

**Confidence component** — recency-weighted, normalised to 0–1:

$$
C = \frac{\sum_i w_i \cdot \frac{c_i - 1}{4}}{\sum_i w_i}
$$

**Recency component** — decay since the last review, relative to the current scheduling interval $I$ (days), with $\Delta t$ = days since last review:

$$
R = \exp\left(-\frac{\Delta t}{\max(I, 1)}\right)
$$

This is the "have I forgotten it yet" term: it sits at 1.0 immediately after review and falls to ≈ 0.37 exactly when the topic becomes due, and lower once overdue. It is what makes a topic decay into 🟡/🔴 without the user doing anything.

### 7.2 Edge cases

- No sessions → score is `null`, status **Not Started**. Never render as 0, which would be indistinguishable from "answered everything wrong".
- Exactly one session → the formula applies unchanged; the UI marks the score **provisional** until 3 sessions exist.
- Sessions with `questionsAttempted = 0` are rejected at validation (FR-4.1).
- Scores are clamped to `[0, 100]` and rounded to one decimal place for storage, integer for display.

### 7.3 Roll-up

A parent topic's aggregate score is the weighted mean of the scores of itself and all descendants that have at least one session, weighted by total questions attempted in the trailing 180 days. Topics with no sessions are excluded rather than counted as zero. A subject's score is the roll-up of its root topics.

### 7.4 Health status

| Status | Condition |
|---|---|
| 🟢 Strong | score ≥ 75 **and** not overdue |
| 🟡 Needs review | 50 ≤ score < 75, **or** score ≥ 75 and overdue by ≤ 7 days |
| 🔴 At risk | score < 50, **or** overdue by > 7 days, **or** neglected (no session in ≥ `neglectThresholdDays`) |

Thresholds are user-configurable (FR-8.2).

### 7.5 Progress status

| Status | Condition |
|---|---|
| Not Started | zero sessions |
| In Progress | ≥ 1 session and not qualifying as Mastered or Needs Review |
| Needs Review | due or overdue today |
| Mastered | score ≥ 85, ≥ 3 sessions, current interval ≥ 30 days, and no lapse in the last 3 sessions |

### 7.6 Recalculation

Scoring is a pure function of `(sessions, schedule, settings, asOfDate)`. Because of the recency term the score changes with the passage of time, so it is computed **on read** for display and **snapshotted on write** (FR-7.10) whenever a session is created, edited or deleted. There is no background job in v1; the dashboard computes current values on request.

---

## 8. Scheduling Algorithms

### 8.1 Outcome → grade mapping (FR-5.4)

Both algorithms consume a 1–4 grade (Again / Hard / Good / Easy). Sessions produce accuracy and confidence, so the mapping is:

Let $a$ = accuracy (0–1) and $c$ = confidence (1–5). Define a blended performance value:

$$
p = 0.7a + 0.3\cdot\frac{c-1}{4}
$$

| Grade | Condition |
|---|---|
| 1 — Again | $p < 0.45$ **or** $a < 0.40$ |
| 2 — Hard | $0.45 \le p < 0.65$ |
| 3 — Good | $0.65 \le p < 0.85$ |
| 4 — Easy | $p \ge 0.85$ **and** $a \ge 0.90$ |

The `a < 0.40` floor and the `a ≥ 0.90` ceiling stop high confidence from disguising poor results, and stop low confidence from suppressing genuinely excellent results. The resulting grade is displayed before save and can be overridden (FR-5.4); the value actually used is persisted in `StudySession.gradeUsed`.

### 8.2 FSRS (default)

Implemented via a well-maintained TypeScript FSRS library (e.g. `ts-fsrs`, MIT). Persisted state per topic: `stability`, `difficulty`, `repetitions`, `lapses`, `lastReviewedOn`. Parameters are the published defaults; per-user parameter optimisation is out of scope for v1. Requested retention defaults to 0.90.

### 8.3 SM-2

Standard SuperMemo-2. Ease factor starts at 2.5, floor 1.3, updated as
`EF' = EF + (0.1 − (5 − g') × (0.08 + (5 − g') × 0.02))` where `g'` maps grades 1–4 to SuperMemo quality 1, 3, 4, 5. Intervals: 1 day → 6 days → `round(previous × EF)`. Grade 1 resets repetitions to 0 and interval to 1 day, incrementing `lapses`.

### 8.4 Manual

Ordered ladder from settings (default `[1, 3, 7, 14, 30, 60]`). Grade ≥ 2 advances one rung (capped at the last); grade 1 resets to index 0. `nextReviewOn = lastReviewedOn + ladder[index]`.

### 8.5 Interface

```ts
interface SchedulerInput {
  grade: 1 | 2 | 3 | 4;
  reviewedOn: Date;
  state: ScheduleState | null;   // null on first review
  settings: SchedulerSettings;
}

interface SchedulerOutput {
  nextReviewOn: Date;
  intervalDays: number;
  state: ScheduleState;
}

interface Scheduler {
  readonly id: 'FSRS' | 'SM2' | 'MANUAL';
  schedule(input: SchedulerInput): SchedulerOutput;
}
```

Adding an algorithm means adding one implementation and one registry entry. No call site changes (FR-5.8).

### 8.6 Replay

Because back-dating is allowed (FR-4.7) and sessions are editable (FR-4.4), the schedule for a topic is derived by **replaying** all its sessions in chronological order through the scheduler from a null initial state. This keeps the stored schedule consistent with history and makes the whole thing testable as a pure function.

---

## 9. API Surface

REST over JSON. All routes under `/api/v1`. All routes except `/auth/login` and `/auth/refresh` require a bearer access token. Every data route is scoped to the authenticated user; ownership is verified server-side on every request (see §11.2).

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Authenticate, issue tokens |
| POST | `/auth/refresh` | Rotate access token |
| POST | `/auth/logout` | Revoke refresh token |
| POST | `/auth/change-password` | Change own password |
| GET | `/me` | Current user + settings |
| PATCH | `/me/settings` | Update settings |
| GET/POST | `/admin/users` | List / create users (ADMIN only) |
| PATCH/DELETE | `/admin/users/:id` | Update / delete user (ADMIN only) |
| GET/POST | `/subjects` | List / create subjects |
| GET/PATCH/DELETE | `/subjects/:id` | Read / update / delete subject |
| GET | `/subjects/:id/tree` | Full topic tree with computed metrics |
| GET/POST | `/topics` | List (filterable) / create topic |
| GET/PATCH/DELETE | `/topics/:id` | Read / update / delete topic |
| POST | `/topics/:id/move` | Re-parent or reorder |
| GET | `/topics/:id/health` | Health view payload for one topic |
| GET | `/topics/:id/history` | Competency snapshots for the retention curve |
| GET/POST | `/topics/:id/sessions` | List / create study sessions |
| PATCH/DELETE | `/sessions/:id` | Update / delete session |
| POST | `/topics/:id/schedule/override` | Set next review date / snooze / suspend |
| GET | `/review/queue` | Overdue, due today, upcoming |
| POST | `/review/start` | Build a filtered study session list |
| GET | `/analytics/dashboard` | Today's summary, streak, activity heatmap |
| GET | `/analytics/mastery` | Mastery bars for a subject |
| GET | `/analytics/heatmap` | Topic heatmap data |
| GET | `/analytics/retention` | Retention curve series |
| GET | `/export/json` | Full user data export |
| GET | `/export/sessions.csv` | Session CSV export |

Conventions: `snake_case` never — JSON is `camelCase`. Errors use a consistent envelope `{ error: { code, message, details? } }` with RFC 7807-style codes. List endpoints are cursor-paginated. All mutating requests are validated with Zod schemas shared between client and server.

---

## 10. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF-1 | **Performance** — dashboard and topic tree endpoints respond in < 300 ms p95 for a dataset of 20 subjects, 2,000 topics and 20,000 sessions on commodity hardware. |
| NF-2 | **Scale** — the system targets tens of users per instance, not thousands. Design decisions may assume a single-node deployment. |
| NF-3 | **Responsive UI** — usable from 360 px to 2560 px wide. Primary flows (view queue, log session) must be fully usable on a phone in portrait. |
| NF-4 | **Accessibility** — WCAG 2.1 AA: keyboard operable throughout, visible focus, 4.5:1 contrast. Health status must never be conveyed by colour alone — always pair with an icon or text label. |
| NF-5 | **Portability (database)** — identical behaviour on PostgreSQL 15+, SQLite 3.40+ and Cloudflare D1, selected by environment variable, with no application code branching on provider. |
| NF-6 | **Testability** — scoring and scheduling are pure functions with no I/O, unit-tested with table-driven cases including boundaries. Target ≥ 90% line coverage on `packages/core`, ≥ 70% overall. |
| NF-7 | **Observability** — structured JSON logging via a `Logger` interface with request IDs; no PII or credentials in logs. Output must be identical on Docker stdout and Cloudflare Workers Logs. `/healthz` and `/readyz` endpoints. |
| NF-8 | **Data integrity** — foreign keys enforced (`PRAGMA foreign_keys = ON` for SQLite); multi-step writes wrapped in transactions. |
| NF-9 | **Timezone correctness** — all instants stored in UTC; all day-boundary logic uses the user's IANA timezone and day start hour. Verified by tests across DST transitions. |
| NF-10 | **Browser support** — current and previous major versions of Chrome, Edge, Firefox and Safari. |
| NF-11 | **Deployment (self-hosted)** — single `docker compose up` brings up API, web and PostgreSQL. SQLite mode requires no container. |
| NF-11a | **Local development** — a clean clone shall reach a running application on Node.js with SQLite in under five minutes using only documented npm scripts, with no Docker and no cloud account (FR-D.7). Cloudflare tooling shall be an optional dev dependency whose absence does not break `npm install`, `npm run dev`, `npm run build` or the default test run. |
| NF-12 | **Backup** — documented procedure: `pg_dump` for PostgreSQL, file copy for SQLite, `wrangler d1 export` for D1, plus the JSON export as a user-level fallback. |
| NF-13 | **Portability (runtime)** — the API shall run unmodified on Node.js 20+ and on the Cloudflare Workers runtime. Application code shall depend only on Web-standard APIs (`fetch`, `Request`, `Response`, `URL`, `crypto.subtle`, `TextEncoder`); Node built-ins (`fs`, `path`, `crypto`, `process`, `Buffer`) are prohibited outside the Node entrypoint. |
| NF-14 | **Cold start** — the Workers bundle shall stay under the 3 MB compressed script limit and cold-start in under 200 ms p95. Bundle size shall be checked in CI. |
| NF-15 | **Statelessness** — no in-process state may be relied upon between requests (no in-memory caches, sessions, counters or timers). All state lives in the database or a Cloudflare binding. |

---

## 11. Security Requirements

### 11.1 Baseline

| ID | Requirement |
|---|---|
| SEC-1 | All traffic over HTTPS in production; HSTS enabled. |
| SEC-2 | Argon2id password hashing; passwords never logged, returned or included in exports. |
| SEC-3 | Minimum password length 12 characters, checked against a common-password deny list. |
| SEC-4 | Access tokens are short-lived and signed with a secret loaded from the environment; refresh tokens are stored hashed and are rotated on use. |
| SEC-5 | Secrets are supplied via environment variables (Node) or Worker secret bindings (`wrangler secret put`) only. No secret is committed to the repository or placed in `wrangler.toml` `[vars]`. Configuration is validated on first request and the request fails closed if `JWT_SECRET` is missing or default. |
| SEC-6 | Security headers on every response, including a Content-Security-Policy with no `unsafe-inline`. Applied by shared middleware so both deployment targets are covered identically. |
| SEC-7 | CORS restricted to a configured origin allow-list. |
| SEC-8 | Global rate limiting plus stricter limits on authentication endpoints (FR-1.10). Implemented behind a `RateLimiter` interface: in-memory on Node, Cloudflare Rate Limiting binding (or a Durable Object) on Workers, since NF-15 forbids in-process counters. |
| SEC-9 | Dependency scanning (`npm audit`, Dependabot) runs in CI; the build fails on high or critical advisories. |

### 11.2 OWASP Top 10 mapping

- **A01 Broken Access Control** — the primary risk here. Every query is scoped by `userId` at the repository layer, never by trusting a client-supplied id. Route handlers must resolve ownership before acting on any `:id`. Admin-only routes are gated by an explicit role middleware, not by hiding UI. Insecure direct object reference tests are mandatory for every resource route.
- **A02 Cryptographic Failures** — Argon2id, TLS in transit, no home-grown crypto, no sensitive data in `localStorage` (refresh token in an `HttpOnly` cookie).
- **A03 Injection** — Prisma parameterised queries only; raw SQL is prohibited without review. All input validated with Zod. React escapes by default; `dangerouslySetInnerHTML` is banned. CSV export cells beginning with `= + - @` are prefixed with `'` to prevent formula injection in spreadsheet software.
- **A04 Insecure Design** — cascade deletes require typed confirmation; destructive operations are transactional.
- **A05 Security Misconfiguration** — production builds disable stack traces in responses; default credentials cannot survive startup validation.
- **A07 Identification & Authentication Failures** — rate limiting, forced password change on first login, refresh token revocation on logout, generic error messages that do not disclose whether an email exists.
- **A08 Software & Data Integrity Failures** — lockfiles committed, CI installs with `npm ci`.
- **A09 Logging & Monitoring Failures** — authentication successes and failures, admin user-management actions and account deletions are logged with actor, action, target and timestamp.
- **A10 SSRF** — no server-side fetching of user-supplied URLs exists in the design; introducing one requires an allow-list.

---

## 12. Out of Scope for v1

Flashcards or per-question scheduling · storing question text, answers, images or LaTeX · in-app quiz taking or auto-marking · native mobile apps · offline/PWA support · email or push notifications · data import · sharing, collaboration or shared decks · AI-generated topics, questions or summaries · per-user FSRS parameter optimisation · file attachments · public API or third-party integrations · SSO/OAuth · internationalisation (English only).

Several of these are deliberately *enabled* by the design rather than blocked by it: the `Scheduler` interface accommodates per-question scheduling, and the versioned lossless export accommodates a future importer.

---

## 13. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) end to end | One language, shared types and Zod schemas between client and server |
| Repo | npm workspaces monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/core`, `packages/shared` | `packages/core` holds pure scoring and scheduling logic with zero I/O, making it trivially testable; `apps/api` and `apps/worker` are thin entrypoints over shared route handlers |
| Frontend | React 18 + Vite | Fast builds; SPA is sufficient — no SEO or SSR requirement |
| Routing | React Router | Standard for SPAs |
| Server state | TanStack Query | Caching, invalidation and refetching for a read-heavy dashboard |
| Forms | React Hook Form + Zod resolver | Shares validation schemas with the API |
| UI | Tailwind CSS + shadcn/ui (Radix primitives) | Accessible primitives out of the box, supporting NF-4 |
| Charts | Recharts | Covers bars, lines and calendar-style grids without a heavy dependency |
| Backend | **Hono 4** on Node.js 20 LTS (`@hono/node-server`) or Cloudflare Workers | Web-standard `Request`/`Response`; the same router runs on both targets unmodified. Chosen over Express specifically to satisfy NF-13 — see §14.2 |
| ORM | Prisma with driver adapters | Best-in-class TypeScript types; multi-provider caveats handled per §6.3 |
| Database | PostgreSQL 15+ (self-hosted prod), SQLite (local dev), Cloudflare D1 (Workers prod) | Per the original requirement, extended for the Workers target |
| Auth | `jose` (JWT) + Argon2id via `hash-wasm` | Both are WebCrypto/WASM based and run on Workers. `jsonwebtoken` and native `argon2` bindings are Node-only and therefore excluded |
| Validation | Zod | Single source of truth for types and runtime validation |
| Scheduling | `ts-fsrs` (MIT) + in-house SM-2 and manual | No need to reimplement FSRS; pure computation, runtime-agnostic |
| Dates | `date-fns` + `date-fns-tz` | Timezone-correct day boundaries per NF-9; relies on the `Intl` API, present in both runtimes |
| Testing | Vitest (unit), Vitest + `fetch` against the Hono app (API), `@cloudflare/vitest-pool-workers` (Workers integration), Playwright (E2E) | Testing the Hono app directly avoids Supertest's Node-server coupling |
| Quality | ESLint (incl. a rule banning Node built-in imports outside `apps/api`), Prettier, `tsc --noEmit`, Husky + lint-staged | Mechanically enforces NF-13 |
| CI | GitHub Actions — lint, typecheck, unit, integration against **all three** database providers, Workers bundle-size check, E2E against both deployment targets | Directly validates NF-5, NF-13 and NF-14 |
| Deploy | Docker + docker compose (self-hosted) · Wrangler + Workers Static Assets (Cloudflare) | NF-11 and §14 |

---

## 14. Deployment Targets & Cloudflare Workers Compatibility

Cloudflare Workers support is **optional**: the product must remain fully functional self-hosted with no Cloudflare account. The requirement is that one codebase can target either, chosen at build time.

### 14.1 Supported targets

| ID | Target | Runtime | Database | Static assets | Status |
|---|---|---|---|---|---|
| T1 | Local development | Node.js 20 (host, no container) | SQLite file (default) **or** PostgreSQL 15+ | Vite dev server | Required |
| T2 | Self-hosted server | Node.js 20 in Docker | PostgreSQL 15+ | Served by the API or a reverse proxy | Required |
| T3 | Cloudflare Workers + D1 | `workerd` | Cloudflare D1 | Workers Static Assets | Optional, must be supported |
| T4 | Cloudflare Workers + PostgreSQL | `workerd` | PostgreSQL via Hyperdrive, or Prisma Postgres | Workers Static Assets | Optional, best-effort |
| T5 | Local Workers emulation | `workerd` via `wrangler dev` | Local D1 (Miniflare) | Wrangler | Required for developing T3 |

**T1 is the primary development loop and the baseline the project must never break.** It requires Node.js and npm and nothing else — no Docker, no Cloudflare account, no cloud services. Running T1 against PostgreSQL is equally required, so that provider-specific behaviour can be reproduced on a laptop before it reaches T2.

| ID | Requirement | Pri |
|---|---|---|
| FR-D.1 | The API shall be deployable to Cloudflare Workers with `npm run deploy:cf` and to a Docker host with `docker compose up`, from the same source tree with no code edits. | M |
| FR-D.2 | The deployment target shall be selected by build configuration only. No runtime feature detection or branching on target inside route handlers, services or repositories. | M |
| FR-D.3 | A developer shall be able to run the Workers target locally against a local D1 database via `wrangler dev`. | M |
| FR-D.4 | Every functional requirement in §5 shall behave identically on all supported targets. Any divergence is a defect. | M |
| FR-D.5 | Documentation shall include a Cloudflare setup guide: D1 creation, migration application, secret binding, custom domain, and Access configuration. | M |
| FR-D.6 | The Workers deployment shall serve the SPA from Workers Static Assets on the same origin as the API, so no CORS configuration is required. | S |
| FR-D.7 | A developer shall be able to clone the repository and reach a running application on Node.js with SQLite using only `npm install`, `npm run db:migrate` and `npm run dev`. Docker, Cloudflare credentials and any network service other than the npm registry shall not be required. | M |
| FR-D.8 | Switching the local database between SQLite and PostgreSQL shall require changing `DATABASE_PROVIDER` and `DATABASE_URL` and re-running migrations — no code edit, no rebuild step beyond `prisma generate`. | M |
| FR-D.9 | A `docker compose` profile shall be provided that starts **only** PostgreSQL, so a developer can run the API on the host against a containerised database (T1 with PostgreSQL) without containerising the application. | M |
| FR-D.10 | A seed command shall populate a realistic demo dataset (multiple subjects, a multi-level topic tree, and back-dated sessions producing a non-empty review queue) so that dashboard and analytics work can be developed without hand-entering data. | S |

### 14.1.1 Environment contract

One contract across all targets. On Node these come from the process environment (via `.env` in development); on Workers from `wrangler.toml` `[vars]` and secret bindings.

| Variable | Required | T1 SQLite | T1/T2 PostgreSQL | T3 Workers |
|---|---|---|---|---|
| `DATABASE_PROVIDER` | yes | `sqlite` | `postgresql` | `d1` |
| `DATABASE_URL` | Node only | `file:./dev.db` | `postgresql://user:pass@localhost:5432/topicmatrix` | unused — D1 binding instead |
| `JWT_SECRET` | yes | ≥ 32 chars, dev value in `.env.example` | same | **secret binding** |
| `NODE_ENV` | yes | `development` | `development` \| `production` | set by build |
| `PORT` | Node only | `3000` | `3000` | n/a |
| `CORS_ORIGINS` | Node only | `http://localhost:5173` | configured origin | n/a — same-origin (FR-D.6) |
| `ARGON2_MEMORY_KIB`, `ARGON2_ITERATIONS` | yes | server-grade defaults | server-grade defaults | tuned to the CPU limit (§14.2) |
| `LOG_LEVEL` | no | `debug` | `info` | `info` |

`DATABASE_URL` is unused on T3 because D1 is reached through a binding rather than a connection string. The config validator must therefore require it conditionally on `DATABASE_PROVIDER`, not unconditionally.

### 14.2 Architectural consequences

Workers support is not a deployment detail bolted on at the end — it constrains the architecture from day one. Deciding it now is far cheaper than porting later.

- **Framework** — Express depends on Node's `http` module and cannot run on `workerd` without heavy compatibility shims. Hono is used instead: it is built on Web-standard `Request`/`Response`, runs natively on both, and has an Express-like API. This supersedes the stack choice recorded in D7.
- **Layering** — all routes are defined once in `packages/api-core` as a Hono app. `apps/api` wraps it with `@hono/node-server`; `apps/worker` exports it as `{ fetch }`. Neither entrypoint contains business logic.
- **Dependency injection** — Workers receive configuration and bindings per request via the `env` argument, not from a process-global. Configuration, the Prisma client, the rate limiter and the clock are therefore constructed per request and passed through Hono's context. No module-level singletons holding connections or config.
- **No Node built-ins** — enforced by an ESLint rule (`no-restricted-imports`) outside `apps/api`.
- **Crypto** — `argon2`/`bcrypt` native bindings do not exist on Workers. Argon2id is provided by `hash-wasm` (WASM, runs on both). JWT signing and verification use `jose` over `crypto.subtle`. Random values come from `crypto.getRandomValues`.
- **Password hashing cost** — Workers CPU time is limited (50 ms default on the free tier, configurable up to 5 minutes on paid). Argon2id parameters must be tuned to fit within the configured CPU limit; the memory cost that is comfortable on a server may not be. Parameters are configuration, and the chosen values are recorded with a benchmark. This is a genuine security-versus-platform tension and must not be resolved by silently weakening the hash — if the target limit cannot accommodate acceptable parameters, T3 is documented as requiring a paid plan.
- **No background work** — there is no long-running process, so nothing may depend on one. This is already satisfied: §7.6 computes scores on read, and there are no cron jobs. Any future scheduled work uses Cron Triggers on Workers and a scheduler process on Node, behind a common interface.
- **Statelessness** — NF-15. Rate limiting in particular cannot use an in-memory counter on Workers; it uses the Rate Limiting binding or a Durable Object.
- **Logging** — pino targets Node streams. A minimal `Logger` interface writing structured JSON via `console` is used instead, so the same output format reaches both Docker logs and Workers Logs.

### 14.3 Prisma on Workers

Prisma's default query engine cannot run on `workerd`. The Workers target uses **driver adapters** with the `driverAdapters` preview feature:

- **T3 (D1)** — `@prisma/adapter-d1` bound to a D1 binding declared in `wrangler.toml`.
- **T4 (PostgreSQL)** — `@prisma/adapter-pg` over a Hyperdrive binding, or Prisma Postgres over HTTP.

Migrations for D1 are generated with `prisma migrate diff` and applied with `wrangler d1 migrations apply`; `prisma migrate dev` is used only for the SQLite and PostgreSQL targets. The generated client must be built with the correct engine type per target, so `prisma generate` runs as part of each target's build.

If Prisma's Workers story proves too costly in bundle size (NF-14) or D1 fidelity, the fallback is Kysely with `kysely-d1`, which is smaller and D1-native. `packages/core` is unaffected either way because it performs no I/O; only the repository layer would change. This fallback should be evaluated at M0 rather than discovered at M7.

### 14.4 D1 limitations to design around

| Limit | Consequence |
|---|---|
| No interactive transactions | Multi-step writes (e.g. delete-subtree, replay-and-rewrite-schedule) must be a single batch or idempotent. See §6.3. |
| Database size cap (10 GB) | Not a practical constraint at the scale in NF-2. |
| Query result size limits | List endpoints must be paginated \u2014 already required by §9. `GET /subjects/:id/tree` on a very large tree is the main risk and must be depth- or page-limited. |
| No `PRAGMA foreign_keys` control mid-transaction | Cascade deletes are performed explicitly in dependency order rather than relying on deferred constraints. |
| Single-region primary with read replication | Write latency for distant users; acceptable for a personal tool. |
| No stored procedures, no extensions | Already assumed; all logic is in application code. |

Note that the JSON export (FR-9.1) reads a user's entire dataset. On D1 it must stream or paginate internally rather than issue one unbounded query, and must fit the Workers CPU and response limits.

### 14.5 Authentication on Workers

`HttpOnly` cookies work normally on Workers, so the refresh-token design in FR-1.3 is unchanged. Because the SPA and API share an origin under T3 (FR-D.6), `SameSite=Strict` remains viable.

Optionally, Cloudflare Access may be placed in front of the deployment as an additional perimeter. This is **additive only** — application-level authentication and authorisation (§11.2) remain mandatory and must never be relaxed on the assumption that Access is present.

### 14.6 What is explicitly not required

Workers KV or R2 usage · Durable Objects beyond the optional rate limiter · edge-side rendering · multi-region write replication · Cloudflare Queues · Workers AI · Pages Functions (Workers Static Assets is used instead).

---

## 15. Decisions Taken

Recorded here because they resolve ambiguities in the source document.

| # | Question | Decision |
|---|---|---|
| D1 | Platform | Responsive web application only. No PWA, no native mobile. |
| D2 | Authentication | Self-hosted single instance; administrator creates accounts; email + password with JWT. No self-registration. |
| D3 | Algorithm | FSRS default, SM-2 selectable, manual custom intervals also supported. |
| D4 | **Unit of review** | **Topic level.** Quiz results are logged against a topic and the *topic* is scheduled. The source document's references to scheduling individual "questions" are interpreted as topic-level weakness ranking. |
| D5 | Question content | Aggregate results only — date, source/year, questions attempted, questions correct, confidence. No question text is stored. |
| D6 | Notifications | In-app review queue and dashboard only. No email, no push. |
| D7 | Stack | TypeScript, Vite + React, **Hono**, Prisma, REST, Tailwind + shadcn/ui, Vitest. *Amended by D12: Hono replaces Express because Express cannot run on Cloudflare Workers.* |
| D8 | Competency score | Weighted blend: accuracy 60%, confidence 25%, recency 15%, recency-weighted across sessions (§7). |
| D9 | Hierarchy | Unlimited nesting; sessions loggable at any level; metrics roll up to parents. |
| D10 | Study time | Optional duration field entered by the user. No built-in timer. |
| D11 | Portability | CSV and JSON export in v1; import deferred but the export format is designed to be lossless. |
| D12 | **Cloudflare Workers** | Supported as an **optional** deployment target (§14). Self-hosting must never require a Cloudflare account. To make this real rather than aspirational, the API is Web-standard and runtime-agnostic from M0: Hono instead of Express, `jose` and `hash-wasm` instead of `jsonwebtoken` and native `argon2`, no Node built-ins, no in-process state, and D1 added as a third database provider. |

---

## 16. Open Questions

Not blocking the start of implementation, but worth resolving before the relevant milestone.

1. **Multiple sources per session** — should logging "2019 Paper 2" and "2020 Paper 1" in one sitting be one session or two? Current assumption: two, one per source.
2. **Neglected vs at-risk** — should a never-started topic appear in the review queue at all, or only in the heatmap? Current assumption: heatmap only; it has nothing to review.
3. **Interval ceiling** — should FSRS intervals be capped (e.g. 365 days) so nothing disappears for years before an exam? Likely yes; needs a decision on the default.
4. **Exam date** — should a subject carry a target exam date that compresses intervals as it approaches? High value for the target user, but adds scheduler complexity. Candidate for v1.1.
5. **Confidence when accuracy is unavailable** — should a "read the chapter" session with no questions be loggable with confidence only? Currently prohibited by FR-4.1's minimum of one question.
6. **Roll-up window** — is 180 days the right trailing window for parent aggregation (§7.3)?
7. **Admin visibility** — administrators currently cannot see user study data at all. Confirm this is desired even for support purposes.
8. **Workers plan tier** — do acceptable Argon2id parameters fit the free tier's 50 ms CPU limit, or is T3 documented as requiring a paid plan? Must be benchmarked at M1, not assumed (§14.2).
9. **Prisma versus Kysely on D1** — evaluate at M0 against bundle size (NF-14) and the no-interactive-transaction constraint, and commit to one before M2.
10. **T4 (Workers + PostgreSQL)** — is Hyperdrive worth supporting in v1, or is D1 sufficient for the Cloudflare path? Currently marked best-effort.
11. **Cloudflare Access** — is it expected in front of the deployment, and if so should the login UI be suppressed? Application auth remains mandatory regardless (§14.5).

---

## 17. Suggested Delivery Milestones

| Milestone | Contents |
|---|---|
| M0 — Foundation | Monorepo, TypeScript config, Hono app skeleton with Node and Workers entrypoints, Prisma multi-provider generation script, D1 adapter spike and Prisma-versus-Kysely decision, ESLint rule banning Node built-ins, CI running against all three databases, health endpoints |
| M1 — Identity | User model, admin seed CLI, login, refresh, forced password change, admin user management, route-level authorisation and IDOR tests, Argon2id parameter benchmark on `workerd` |
| M2 — Structure | Subjects and topic tree CRUD, move/reorder with cycle prevention, materialised path maintenance |
| M3 — Logging | Study session CRUD with validation, session history table |
| M4 — Intelligence | `packages/core`: scoring engine and the three schedulers, replay logic, exhaustive unit tests |
| M5 — Queue | Review queue, launcher with filters, schedule overrides, snooze and suspend |
| M6 — Insight | Dashboard, streak and activity heatmap, mastery chart, topic heatmap, health view, retention curve |
| M7 — Polish | Settings, theming, accessibility audit, exports, Playwright E2E, deployment documentation |
| M8 — Cloudflare | Workers Static Assets wiring, `wrangler.toml`, D1 migration pipeline, rate limiter binding, bundle-size gate, E2E run against a deployed Workers preview, Cloudflare setup guide |
