# Prompt: AI Competition Voting App + Results Dashboard

## Context & Goal

Build a web application for judging an internal AI competition sponsored by our business CEO. The app has two user-facing surfaces:

1. **A voting/scoring interface** used by judges to score competition entries.
2. **A results dashboard** displaying raw, weighted, and normalized scores per entry, with rankings.

The app must work well on desktop, laptop, and mobile (responsive design), and be installable as a PWA.

## Competition Structure

- **Categories:** 2 voting categories: [CATEGORY A NAME] and [CATEGORY B NAME].
- **Entries:** 19 total entries. [SPECIFY: how are they split across the two categories, e.g., 10 in Category A and 9 in Category B? Or is every entry judged in both categories?]
- **Judging criteria:** 4 criteria shared across both categories: [CRITERION 1], [CRITERION 2], [CRITERION 3], [CRITERION 4].
- **Weights:** Each category applies different weights to the 4 criteria:
  - Category A: [e.g., 40% / 30% / 20% / 10%]
  - Category B: [e.g., 25% / 25% / 25% / 25%]
- **Panels:** 2 judging panels, 5 judges each. [SPECIFY: is Panel 1 assigned to Category A and Panel 2 to Category B, or do both panels score all entries?]
- **Scoring scale:** Each judge scores each entry 1–5 on each criterion (integers only — no half points).

## Judge Voting Flow

- **Authentication:** judges log in with their employee ID plus a 4-digit PIN. PINs are pre-assigned per judge (seeded by the admin) and stored hashed server-side. Session persists on the device so judges aren't forced to re-login mid-event, with a logout option. Rate-limit failed PIN attempts.
- A judge sees only the entries assigned to their panel/category.
- For each entry: entry name, short description, and four 1–5 score inputs (one per criterion), optimized for fast tapping on mobile (e.g., segmented buttons rather than dropdowns).
- Scores auto-save as they are entered; judges can revise scores until an admin locks voting.
- Show each judge a progress indicator (e.g., "12 of 19 entries scored") and flag incomplete ballots.

## Score Computation

For each entry, compute and store:

1. **Raw scores:** each judge's 1–5 score per criterion.
2. **Weighted score per judge:** sum of (criterion score × category weight), yielding a 1–5 weighted score.
3. **Normalized score:** apply per-judge z-score standardization, equivalent to Excel's STANDARDIZE function: for each judge, z = (weighted score − that judge's mean weighted score) / that judge's standard deviation of weighted scores, computed across all entries that judge scored. Then average the z-scores across judges for each entry. This corrects for both harsh/lenient judges and judges who use a narrow vs. wide range of the scale. Handle the edge case where a judge's standard deviation is 0 (all identical scores) — fall back to mean-centering (z = 0) for that judge rather than dividing by zero.
4. **Final ranking per category:** ranked by normalized score, with weighted-average score as tiebreaker.

## Dashboard Requirements

- Per-category leaderboard: rank, entry name, average weighted score, normalized score.
- Per-entry detail view: score matrix of judges × criteria, each judge's weighted score, and the normalization adjustment applied.
- Visual indicators of score spread across judges (e.g., min/max or a small distribution bar) to spot outliers.
- Filter/toggle by category and by panel; sortable columns.
- Live-updating (or refresh button) as judges submit scores during the event.
- Export results to CSV.
- [SPECIFY: is the dashboard public to all judges, or admin-only until results are announced? Recommend an admin-only "reveal" toggle.]

## Admin Capabilities

- CRUD for entries, judges, categories, criteria, and weights (or seed via a config file/JSON if simpler).
- Lock/unlock voting globally or per category.
- View completion status per judge.

## Tech Stack & Architecture

- **Frontend:** Vite + React SPA with PWA features (installable, sensible offline behavior — at minimum, cache the shell; ideally queue score submissions made offline and sync when reconnected).
- **Backend & database:** Node.js API (Express or similar) with SQLite as the database (use better-sqlite3 or equivalent). Scores must persist centrally and be shared across all judges. Include the SQLite schema in your proposed data model. [SPECIFY hosting: e.g., self-hosted on a Mac mini behind Cloudflare Tunnel, or an internal server.]
- **Styling:** I will provide a .css file containing our design standard (colors, typography, spacing, component styles). Reuse it as the foundation for this app — import it globally, build components against its classes/variables, and extend it only where a needed style doesn't exist rather than introducing a parallel styling system. Do not pull in a CSS framework like Tailwind or Bootstrap. The result should be clean, professional, and executive-presentable, with a mobile-first layout.
- **Validation:** enforce 1–5 integer scores, one score set per judge per entry, and server-side validation of judge identity (employee ID + hashed PIN check on every write).

## Deliverables

1. Recommended architecture and data model (get my sign-off before implementation).
2. Working app: judge voting flow, dashboard, admin controls.
3. Seed script or admin UI to load the 19 entries, judges (employee IDs + initial PINs), criteria, and weights.
4. Brief README: how to run locally, deploy, and reset for a new competition.

The mara.css file is attached alongside this prompt. Ask me clarifying questions about anything marked [SPECIFY] before you start building.
