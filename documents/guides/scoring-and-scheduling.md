# How scoring and scheduling work

TopicMatrix decides two things for every topic: **how well you know it right now** (your
*competency score*), and **when you should review it next** (its *schedule*). This page explains
both in plain terms — no formulas needed to use the app, but they're here for anyone curious.

## Your competency score (0–100)

A topic's score blends three things from your logged study sessions:

- **Accuracy** — the fraction of questions you got right, weighted so recent sessions count more
  than old ones, and sessions with more questions count more than ones with just a couple.
- **Confidence** — the average of how confident you said you felt (1–5) when logging each
  session, again weighted toward recent sessions.
- **Recency** — how long it's been since you last reviewed the topic relative to its current
  review interval. A topic you're "due" on decays toward a lower recency score the longer it's
  overdue; one you just reviewed scores highest here.

These three combine into one 0–100 score. **A topic with zero sessions has no score at all**
(shown as "—", not 0) — an untouched topic isn't "bad", it's simply not started yet. A topic with
only one or two sessions is marked *provisional*, since one data point isn't a reliable read on
how well you know something.

A subject or a parent topic's score is a roll-up: the (recency-weighted-activity) average of
itself and everything beneath it in the tree, but only counting topics that actually have
sessions — topics with none don't drag the average down to zero.

## Health status

Your score (plus how overdue a topic is) maps to one of four statuses, always shown with both an
icon and a word — never colour alone:

- **Strong** — scoring well and not overdue.
- **Needs review** — either the score has dipped, or it's overdue.
- **At risk** — significantly overdue, or a genuinely low score.
- **Not started** — no sessions logged yet.

## Logging a session and the grade

When you log a session (questions attempted/correct, and how confident you felt), TopicMatrix
computes a **grade** — Again / Hard / Good / Easy — from your accuracy and confidence together.
This grade is what actually drives the scheduling algorithm below. You'll see the computed grade
before saving, and can override it if you feel it doesn't match your experience (e.g. you got the
right answer but only by guessing).

## Scheduling algorithms

Every topic follows one of three algorithms, chosen per-topic (or inherited from the subject, or
your own default in **Settings**):

- **FSRS** (default) — a modern spaced-repetition algorithm that models how memory strength
  decays over time and schedules your next review just before you're likely to forget.
- **SM-2** — the classic SuperMemo-2 algorithm (used by many well-known flashcard apps):
  intervals grow by an "ease factor" that increases on good reviews and resets on poor ones.
- **Manual** — a fixed ladder of days (e.g. 1, 3, 7, 14, 30, 60 — edit this in **Settings**) that
  advances a step on a good review and resets toward the start on a poor one. Useful if you want
  full, predictable control instead of an adaptive model.

Changing a topic's algorithm **replays its whole session history** through the new algorithm, so
its next review date is always a correct reflection of that history — not a one-off recalculation
that could drift out of sync later.

## Tuning it yourself

Under **Settings**, you can adjust:

- The three score weights (accuracy / confidence / recency) — they must add up to 1.0. A live
  preview shows the effect on one of your own topics before you save.
- The score thresholds for "strong" and "needs review".
- Your day boundary (for people who study past midnight — a session logged at 1am still counts
  toward "yesterday" if your day starts later than that).
- The Manual algorithm's interval ladder.

"Reset to defaults" restores the platform's original weights and thresholds at any time.
