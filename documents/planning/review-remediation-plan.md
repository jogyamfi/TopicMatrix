# Code review & UX remediation plan

**Date:** 2026-09-26 · **Scope:** the whole repo as of `16d4a91` (P0–P10 complete, P11 not started).
**Baseline:** `npm test` passes 134/134 tests. `packages/api-core/src/index.test.ts` fails to load on
a clean checkout until `npm run db:generate-schemas` + `prisma generate` have been run (see R-DX-1).

This plan groups the review findings into phases (R1–R5) that can each ship on their own. Every
phase ends with the usual gate: `lint`, `typecheck`, `test`, `test:integration`, `test:cf` (for any
change reachable from `packages/api-core` or `packages/db`), and `test:e2e`.

Severity key: **Critical** = data loss, security, or production outage · **High** = wrong
results users will notice · **Medium** = UX defect or latent bug · **Low** = polish or debt.

---

## Findings summary

| ID | Severity | Area | Finding |
|---|---|---|---|
| C-1 | Critical | API / DB | A new `PrismaClient` is built on **every request** and never disconnected |
| C-2 | Critical | Web / privacy | React Query cache and launcher `localStorage` survive logout, so the next user in the same browser sees the previous user's data |
| C-3 | High | Web / dates | Log Session's default date uses the browser's calendar date. Between midnight and `dayStartHour`, or when the browser timezone differs from the settings timezone, the save is rejected as "in the future" |
| C-4 | High | Web / dates | Date-only values (UTC midnight) are shown with `toLocaleDateString()`, so users west of UTC see every date one day early |
| C-5 | High | Web / cache | After a session is logged, edited or deleted on the topic detail page, the score cards and "Next review" stay stale |
| C-6 | High | Security | Behind nginx (the Docker target), every client has the proxy's IP, so 10 failed logins lock **everyone** out for 15 minutes |
| C-7 | High | Security | An admin can deactivate, or delete, their own account or the last active admin |
| C-8 | High | Scheduling | Snoozing an overdue topic adds days to the **past** due date, so a 1-day snooze of a 10-day-overdue topic leaves it overdue |
| C-9 | High | API errors | In production, `details` is stripped from **all** errors, including 4xx validation field errors and the `mustChangePassword` flag. The web client also discards `details` entirely |
| D-1 | High | Data model | There are two independent "suspended" flags (`Topic.isSuspended` and `ReviewSchedule.isSuspended`). The UI toggles one and the tree badge reads the other; the subject card's due count ignores the topic flag |
| D-2 | High | Scheduling | Changing a subject's default algorithm, the user's default algorithm or the manual ladder, or moving a topic across subjects, never re-derives the affected schedules. Only a topic-level override does (FR-5.7) |
| D-3 | Medium | Snapshots | `CompetencySnapshot.capturedOn` records when the session was logged, not the day it was studied. Back-dated sessions put retention events on the wrong date, and every edit adds a same-day duplicate snapshot, which corrupts the ▲▼ review trend |
| D-4 | Medium | Atomicity | Session create/update/delete and the recalculation that follows run in separate transactions, as do admin user creation + default settings and refresh-token rotation |
| D-5 | Medium | Topic tree | New topics all get `sortOrder = 0`, so the Up/Down reorder buttons swap 0↔0 and do nothing. The order of tied topics is also nondeterministic |
| D-6 | Medium | Auth | `RefreshToken.tokenHash` has no index (every refresh scans the whole table), and rows are never purged. There is no reuse detection, and two tabs refreshing at once log one of them out |
| D-7 | Medium | Settings | `POST /me/settings/reset-scoring` also resets the manual interval ladder, which contradicts its own comment and FR-8.2's "scoring" scope |
| D-8 | Medium | Web | `LogSessionDialog` resets the whole form whenever its parent re-renders, because its effect depends on an inline object literal. For example, a launcher snooze that resolves while the user is typing wipes the form |
| P-1 | Medium | Performance | `GET /subjects` runs `computeSubjectSummary` per subject (~6 queries each). Subject-level retention fetches snapshots one topic at a time. The dashboard loads every session the user has ever logged |
| P-2 | Low | Performance | `POST /topics/:id/sessions/preview` and the settings preview make one network round-trip per keystroke for pure functions that already exist in `packages/core` |
| O-1 | Low | Ops | `errorHandler` logs every 4xx as `error`. `x-request-id` is accepted unbounded from the client. The in-memory rate limiter never evicts keys. `/readyz` doesn't check the DB |
| O-2 | Low | Ops | The nginx config sets no security headers or CSP on the SPA HTML (only API responses get them), no gzip, and no long-cache headers for hashed assets |
| O-3 | Low | Deploy | The refresh cookie is `Secure`, so a Docker install reached over `http://<LAN-IP>` (not `localhost`) silently loses the session on every reload. This is undocumented |
| R-DX-1 | Low | DX | `npm test` on a fresh clone fails until the Prisma clients are generated. There is no `postinstall` or `pretest` hook |

### UX gaps (not bugs, but high-leverage improvements)

| ID | Area | Gap |
|---|---|---|
| U-1 | Account | Users can't change their own password outside the forced flow, and after a forced change they are logged out and must log in again |
| U-2 | Admin | Admins can't reset a user's password (issue a new temporary one) or change a user's role |
| U-3 | Subjects | There is an archive API but no UI to archive, view or unarchive subjects |
| U-4 | Topic detail | The history data is fetched but never charted. The page has no retention or accuracy-vs-confidence chart, no subject/topic breadcrumb, and its header buttons overflow on mobile |
| U-5 | Review | The queue hides never-studied topics (by design, Q2), so a new learner's queue stays empty and nothing points them to "start these". The launcher's completion screen counts skipped and snoozed topics as "reviewed" |
| U-6 | Launcher | The topic card has no link to its detail page, and the notes are plain text only |
| U-7 | Settings | The timezone defaults to `Europe/London` for everyone instead of being detected from the browser. The list offers only 10 zones, although `Intl.supportedValuesOf('timeZone')` is now universally available |
| U-8 | Forms | Server validation messages arrive as a generic "Validation failed" (see C-9) and are never shown next to the field that caused them |
| U-9 | Tags | Tags can't be renamed. The tag → topics view shows no scores (the route returns placeholder `null` metrics) and doesn't link through to topics |
| U-10 | Onboarding | A brand-new account lands on an empty dashboard with no guided "create a subject → add topics → log a session" path |
| U-11 | Navigation | There is no global topic search or jump-to. This is the same missing endpoint that blocks the generic topic pickers in the launcher and analytics (P8/P9 deferred items) |

---

## Phase R1 — Critical fixes (small, isolated, ship first)

**Status: done** (PR #1). Also fixed `npm run test:cf`, which the 0.12 `vitest-pool-workers` bump had
broken: its `@vitest/runner`/`@vitest/snapshot` peers resolved to 3.x against vitest 2.1.9, so
the root `overrides` now pin both to `$vitest`.

**Goal:** remove the production-outage, privacy and "wrong date" defects. Each item below is only a
few lines; all of them fit in one PR.

1. **C-1: one Prisma client per process.** In `apps/api/src/index.ts`, build the `Db` once at
   module scope (the same deliberate-singleton exception already used for the rate limiter) and
   pass `createDb: () => nodeDb` into `buildDeps`. Call `db.disconnect()` on `SIGTERM`/`SIGINT`.
   Workers keep their per-request construction. Update the NF-15 comments in `deps.ts` and
   `client.ts` to say that connection pools are process-scoped infrastructure, like the limiter.
   *Test:* an integration test that makes 50 sequential requests and asserts that
   `createPrismaClient` was called once.
2. **C-2: clear per-user client state on auth change.** In `auth-store.ts` `logout()`/`reset()`,
   and whenever `login()` resolves a different user id, call `queryClient.clear()` and
   `clearLauncherRun()`. Key the launcher storage by user id (`topicmatrix:launcher-run:<userId>`).
   *Test:* an E2E step: log in as A → view subjects → log out → log in as B, and assert that none
   of A's subjects are rendered.
3. **C-3: compute "today" the way the server does.** Import `startOfUserDay` from
   `@topicmatrix/shared` (it is pure `Intl` code, already browser-safe) and use the settings query's
   `timezone`/`dayStartHour` for both the default date and the `max` attribute of the date input
   in `log-session-dialog.tsx` and `edit-session-dialog.tsx`. Move this into a
   `useUserToday()` hook in `lib/`. Fix `lib/date-range.ts` the same way.
4. **C-4: date-only formatting helper.** Add `formatDateOnly(iso)` to `lib/utils.ts`, using
   `toLocaleDateString(undefined, { timeZone: 'UTC' })`. Replace the four call sites
   (`session-history-table.tsx:126`, `topic-detail-page.tsx:270`, `launcher-page.tsx:123`,
   `subjects-page.tsx:20`) and every date shown in the analytics tables. Add an ESLint
   `no-restricted-syntax` rule or a code-review note banning a bare `toLocaleDateString()` on
   date-only fields.
5. **C-5: invalidate the topic detail.** Add `queryKeys.topics.detail(topicId)` (a prefix that also
   covers the `'schedule'` sub-key) to `invalidations.afterSessionWrite`. Also make
   `afterTopicWrite` invalidate `topics.detail`, `topics.listBySubject`, `review.queue` and
   `['analytics']`, since renaming or suspending a topic changes those too. Make
   `afterSubjectWrite` invalidate the queue and analytics as well (for archiving and default
   algorithm changes).
6. **C-6: trusted-proxy client IP.** Add a `TRUST_PROXY` config value (`false` | a hop count |
   a CIDR list). When it is set, `getNodeClientIp` reads `X-Real-IP` / the right-most untrusted
   `X-Forwarded-For` entry. Set it in `docker-compose.yml` for the `api` service. Document it in
   `deployment.md`.
7. **C-7: admin lockout guards.** In `admin-users.ts`, reject `PATCH isActive:false` and `DELETE`
   when `targetId === actor.id` (`FORBIDDEN`) or when the target is the last active `ADMIN`
   (`CONFLICT`). Disable the corresponding buttons in `users-page.tsx` for the current user.
8. **C-8: snooze from today.** In `scheduling.ts:206`, use
   `addDays(max(existing?.nextReviewOn, today), days)`, where `today` is `startOfUserDay(asOfDate, …)`,
   not the raw instant. Add a unit test for an overdue topic.
9. **C-9: stop hiding client-actionable error details.** In `toErrorEnvelope`, always include
   `details` for `AppError`s with a status below 500, and suppress them only for 5xx and unknown
   errors. Carry `details` through `ApiError` in `api-client.ts`, and have `auth-store.login` throw
   an `ApiError` instead of a plain `Error`. (This is also the groundwork for U-8.)
10. **R-DX-1:** add `"pretest": "npm run db:generate-schemas && prisma generate …"` (or a
    `postinstall`) so that `npm test` works on a clean clone. Record this in the README.

**Exit criteria:** every item has a regression test (unit, integration or E2E, as noted), and a
manual check with the browser timezone set to `America/Los_Angeles` shows correct dates and lets
you log a session at 01:00 local time.

---

## Phase R2 — Data integrity & scheduling consistency

**Status: implemented.** Migration `20260926120000_r2_data_integrity` (SQLite/PostgreSQL) and
`apps/worker/migrations/0003_r2_data_integrity.sql` (D1). The SQLite migration was tested against
seeded pre-R2 data, and the D1 one runs under `test:cf`. The PostgreSQL one was generated offline
and is **not runtime-verified** (still no Docker on the dev machine).

Decisions taken while implementing it:
- **D-1:** `ReviewSchedule.isSuspended` is dropped. The API still reports `schedule.isSuspended`,
  now derived from the topic. Suspending a never-studied topic no longer creates an empty schedule
  row. The JSON export is now `version: 2` (schedules no longer carry the flag).
- **D-3:** snapshots are fully derived: one per study day, scored as of that day. Changing the
  scoring *weights* does not rebuild existing snapshots. Live scores always use the current
  weights, and the history keeps the weights in force when each topic was last recalculated.
- **D-2:** a recalculation keeps a next-review date that was set directly on a never-studied topic
  (a schedule with no `lastReviewedOn`), changing only its algorithm.
- **D-5:** `POST /topics/:id/move` takes `position` (0-based) instead of `sortOrder`.
- **D-6:** the grace window is 30 s, and revoked tokens are kept for 7 days so reuse can be
  detected. The client uses a `BroadcastChannel` for sign-in and sign-out only, not to share
  access tokens: the server-side grace window already handles concurrent refreshes.
- Found while doing this: `POST /topics/:id/schedule/override` never returned the `status` field
  that the shared response schema requires. Every Pause/Snooze in the web UI therefore showed an
  error toast even though it had worked. It now returns `status`, and a test parses the response
  with the shared schema.

**Goal:** make stored state self-consistent and remove the silent divergences. This phase includes
one schema migration, which must be generated for sqlite, postgres **and** D1
(`apps/worker/migrations`).

1. **D-1: one suspend flag.** Make `Topic.isSuspended` the single source of truth. It already
   exists for topics that have never been scheduled. Steps:
   - Write a migration that copies `ReviewSchedule.isSuspended = true` into `Topic.isSuspended`,
     then drops the schedule column (or keeps it deprecated for one release).
   - Make `applyScheduleOverride({kind:'suspend'})` write the topic row.
   - Make `computeSubjectSummary`'s due count and `computeEligibleTopicItems` read only the topic
     flag.
   - Keep `scheduleView.isSuspended` in the API as a derived field, so the web code does not
     change.
2. **D-2: recalculate when the effective algorithm changes.** Add
   `recalculateSchedulesForTopics(db, userId, topicIds)` and call it from:
   - `PATCH /subjects/:id` when `defaultAlgorithm` changes (topics with no override);
   - `PATCH /me/settings` when `defaultAlgorithm` changes (topics with no override and no subject
     default) or `manualIntervals` changes (topics whose effective algorithm is `manual`);
   - `moveTopic` across subjects, for the moved subtree.

   Return `{ schedulesChanged: n }` so the UI can toast "Next-review dates were updated for n
   topics". Recalculation rebuilds the snapshots too, so apply D-3 first or in the same change.
3. **D-3: snapshots are keyed to the day studied.** In `recalculateTopicSchedule`, rebuild the
   topic's snapshot series from the replay: one snapshot per distinct `studiedOn`, scored as of
   that day. This replaces "append one snapshot at `now`". It makes back-dated, edited and deleted
   sessions produce the same history a fresh replay would (the same principle as §8.6 for
   schedules). This fixes the retention event dates and the ▲▼ review trend in one move. Cost is
   O(sessions) per topic, which the existing replay already pays.
4. **D-4: atomic writes.** Let `recalculateTopicSchedule` (and the new D-2 helper) accept an
   existing `tx`. Session create/update/delete then run as
   `unitOfWork.run(tx => { write; recalc(tx) })`. Do the same for admin user create + default
   settings, and for refresh-token revoke + create. Note in the P11 handover that these become
   `DB.batch()` candidates.
5. **D-5: deterministic sibling ordering.**
   - On topic create, set `sortOrder = max(sibling.sortOrder) + 1`.
   - Add `(sortOrder, name)` as the tiebreak in `listBySubject`.
   - Replace the two-call swap in `subject-tree-page.tsx:88` with one
     `POST /topics/:id/move { position }` that renumbers the siblings inside the move's
     transaction.
   - Include a one-off data migration that renumbers existing siblings by `createdAt`.
6. **D-6: refresh-token hygiene.**
   - Make `tokenHash` `@unique`.
   - Purge rows that are expired, or revoked more than 7 days ago. Do it opportunistically on login
     (cheap and runtime-agnostic, so no cron is needed).
   - Detect reuse: presenting an already-revoked token revokes all of that user's tokens.
   - Allow a short grace window (~30 s) in which the *just-rotated* token returns the successor's
     access token instead of a 401. That fixes multi-tab logouts. On the client, add a
     `BroadcastChannel('auth')` so that tabs share a refreshed token instead of racing.
7. **D-7:** stop `reset-scoring` from resetting the manual ladder, or rename the action and the
   button to say that it does. Resetting only the weights and thresholds matches FR-8.2.
8. **D-8:** make `LogSessionDialog`'s reset effect depend on `topic?.id` (and open state), not the
   object identity. Audit the other dialogs (`edit-session`, `edit-topic`, `subject-dialog`) for
   the same pattern.

**Exit criteria:** a new integration test that back-dates a session, then edits it, then deletes
it, and asserts that the snapshot series equals a fresh replay. A test that changing the subject
default algorithm moves `nextReviewOn`. Migrations applied on sqlite, the offline-generated
postgres migration and the D1 migration all review cleanly.

---

## Phase R3 — Everyday UX improvements

**Goal:** the highest-leverage changes to the daily "what do I study, log it, see progress" loop.

1. **U-8 + C-9 follow-through: field-level errors.** Add a small `useFormErrors(apiError)` helper
   that maps Zod `flatten().fieldErrors` onto inputs (`aria-invalid` + `aria-describedby`). Adopt it
   in the Log Session, Edit Session, Subject, Topic, Settings and Create User forms. Do client-side
   validation with the shared Zod schemas before submitting, so obvious mistakes never
   round-trip.
2. **U-4: a better topic detail page.**
   - Render the retention curve and the accuracy-vs-confidence chart for the topic, reusing the P9
     `components/charts/*` and `ChartWithDataTable`. The history fetch that already happens here
     finally gets used.
   - Show real breadcrumbs: `Subjects › <Subject> › <Topic>`, fed from route `handle` data plus the
     loaded names.
   - Make the header button group wrap, and move secondary actions (Edit, Pause) into a `…` menu
     below `sm`.
3. **U-5: review queue for new learners.**
   - Add a fourth, collapsible bucket, **"Not started yet"** (topics with no schedule, oldest
     first, capped at about 10), with a one-click "Log first session". This keeps Q2's decision
     (never-started topics are not *due*) while still surfacing them.
   - Show useful empty states for each bucket, such as "Nothing overdue 🎉 Next review: Tue".
4. **U-5/U-6: a better launcher.**
   - Track each item's outcome (`logged | skipped | snoozed`) in the launcher run.
   - The completion screen shows those counts, the average accuracy of the sessions logged, and a
     "Review skipped items" button.
   - Link the topic name to its detail page (opening in a new tab or a side sheet, so the run
     isn't lost).
   - Invalidate the review queue after a snooze.
   - Add keyboard shortcuts on the launcher (`L` log, `S` skip, `1/3/7` snooze), with a visible
     hint.
5. **U-7: timezone setup.**
   - Default new users' timezone to the admin's configured default.
   - On first login, if the browser's `Intl…resolvedOptions().timeZone` differs from the saved
     setting, show a one-time banner: "Use Europe/Paris?".
   - Populate the settings picker from `Intl.supportedValuesOf('timeZone')`, as a searchable combo
     box.
6. **P-2: instant previews.** Compute the grade preview and the settings score preview on the
   client with `computeGrade` / `computeCompetencyScore` from `@topicmatrix/core` (both pure). Keep
   the server endpoints for API consumers. This removes a request per keystroke and makes the
   grade chips update instantly.
7. **U-10: first-run onboarding.** When the user has zero subjects, the dashboard shows a
   three-step checklist (Create subject → Add topics → Log first session). Each step links to the
   right dialog and ticks itself off from the existing queries.

**Exit criteria:** axe scan still clean. The E2E flow is extended to cover the new queue bucket,
the launcher summary and the field-level error display. A manual keyboard-only pass of the
launcher.

---

## Phase R4 — Account, admin & organisation features

1. **U-1: self-service password change.** Add a "Change password" item to the user menu that
   reuses `change-password-page.tsx` in a non-forced mode (so Cancel is allowed). On success, the
   server issues a fresh access token + refresh cookie for the *current* session and revokes all
   other sessions. The user stays signed in, including after the forced first-login change, which
   removes the extra log-in step.
2. **U-2: admin actions.**
   - `POST /admin/users/:id/reset-password` returns a new temporary password (shown once) and sets
     `mustChangePassword`.
   - `PATCH /admin/users/:id` accepts `role`, subject to the C-7 last-admin guard.
   - Audit both actions.
3. **U-3: archive UI.**
   - An Archive/Unarchive action on the subject card and in the edit dialog.
   - A "Show archived" toggle on the Subjects page (passes `includeArchived=true`).
   - Archived cards are visually muted and read-only apart from Unarchive.
4. **U-9: tags.**
   - `PATCH /tags/:id` for rename, reusing the normalised-name uniqueness.
   - The tag → topics view shows real score/health (reuse `computeTopicHealthView` filtered by tag
     ids, instead of `placeholderTopicMetrics`) and links each row to its topic.
   - A "Review this tag" launch shortcut (the `tagId` filter already exists in `/review/start`).
5. **U-11: topic search.**
   - `GET /topics/search?q=` does a case-insensitive match on `nameNormalised` across the user's
     subjects, capped at 20, and returns the subject name and path.
   - Use it for a global ⌘K / `/` jump-to palette in the app shell, and to replace the
     subject-scoped topic pickers in the launch dialog (the `topicSubtree` mode) and analytics
     (both are P8/P9 deferred items).

**Exit criteria:** integration tests for every new route (including the cross-user isolation
case, which follows the repo's existing convention), and the E2E flow extended for reset-password
and archive.

---

## Phase R5 — Performance, operations & hardening

1. **P-1: remove the N+1s.**
   - Batch the `GET /subjects` summaries: one bulk read each of topics, sessions and schedules for
     all of the user's subjects, then group in memory. This is the same pattern as
     `computeEligibleTopicItems`.
   - Replace the per-topic loop in `computeRetentionSeries` (`analytics.ts:488`) with one
     `competencySnapshots.listBySubject`.
   - Give `computeDashboardAnalytics` a date-bounded query (the last 365 days, plus a streak-only
     query for the distinct `studiedOn` days).
   - Remove the duplicate `listAllForUser` in `estimateMinutesPerItem`.
2. **NF-1 measurement (outstanding since P9).** Add `seed:perf` (20 subjects / 2,000 topics /
   20,000 sessions). Record the p95 of `/subjects`, `/review/queue`, `/analytics/health` and
   `/subjects/:id/tree` before and after item 1. Add list virtualisation to the Topic Health table
   only if the numbers justify it.
3. **O-1: logging and health.**
   - Log 4xx at `warn` and only 5xx at `error`, with the stack trace for 5xx.
   - Validate and truncate the inbound `x-request-id` (ULID/UUID charset, ≤ 64 chars) before
     trusting it.
   - Evict empty or expired keys in `createMemoryRateLimiter`, with a periodic sweep or an LRU cap.
   - Make `/readyz` run `SELECT 1` through the new process-scoped client from C-1.
   - Reset the per-email rate limit counter on a successful login.
4. **O-2: nginx hardening.** Serve the SPA with the same CSP and headers as the API, add
   `gzip on`, `Cache-Control: immutable` for `/assets/*`, and `no-cache` for `index.html`.
5. **O-3: deployment docs.** Document that the stack needs HTTPS (or `localhost`) because of the
   `Secure` refresh cookie. Add a Caddy/Traefik TLS example to `deployment.md`. Optionally add a
   `COOKIE_SECURE=false` dev-only escape hatch, which fails closed when `NODE_ENV=production`.
6. **Dependency debt:** the `react-router-dom` 7.x upgrade, deferred at P10, done as its own
   tested PR.
7. **Carried-over verification:** run the PostgreSQL integration suite and `docker compose up` on
   a machine with Docker. These have been unverified since P1/P10, and several items above (C-1,
   C-6, O-2) change exactly those paths.

**Exit criteria:** NF-1 numbers recorded in `progress.md`. The Docker stack verified end to end
with the E2E suite pointed at `http://localhost:8080`.

---

## Sequencing notes

- **R1 goes before P11.** C-1 in particular changes how `buildDeps` is wired, and P11 touches the
  same seam. D-4 (atomic writes) should also land before P11 so that the D1 `batch()` design
  starts from the final set of multi-step writes.
- **R2's migration** is the only schema change in this plan. Batch D-1, D-5 and D-6 into it, so
  that there is one migration per provider rather than three.
- R3 and R4 are independent of each other and can run in parallel after R1. R3 depends on R1's
  C-9 fix for field-level errors.
- R5 item 7 (Docker/PostgreSQL verification) can happen at any time on a machine that has Docker.
  The earlier the better.
