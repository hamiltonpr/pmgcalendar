# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
# Activate the venv (Windows PowerShell)
.\.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Run the development server
python app.py
```

Visit http://127.0.0.1:5000. Sign in with any username — no real auth exists.

## Architecture

Single-file Flask app (`app.py`) backed by a local SQLite database (`data.db`). All HTML lives in `templates/`, static assets in `static/` (JS in `app.js`, CSS in `style.css`).

**Database schema** — all tables are per-user (scoped by `user TEXT` column):
- `users` — just stores known usernames
- `events` — calendar events with optional recurrence (`recur`, `recur_end`, `recur_config`, `recur_exceptions`)
- `people` — contact list with colored dot status system
- `indicators` — per-week values for goal tracking (keyed by `(user, week, name)`)
- `goals` — goal definitions (name, icon, type, target value/period)
- `categories` — event category labels with colors
- `dot_settings` — per-user config for the People dot color meanings
- `posts` / `comments` — PMG13 shared content board (posts require moderation before appearing)

**DB initialization** runs on app startup via `init_db()` + `migrate_db()`. `migrate_db()` uses `ALTER TABLE ... ADD COLUMN` with try/except to safely add columns to existing databases — this is the pattern for schema migrations.

New users get seeded defaults on first access: `seed_goals()`, `seed_categories()`, `seed_dot_settings()` (all use `INSERT OR IGNORE`).

**Auth** is fake — `session['user']` is set to whatever username is typed at login. `require_user()` returns `session.get('user', 'demo')` as a fallback.

**API pattern** — REST endpoints under `/api/`. Most support GET + POST on the same route, with POST handling both create (no `id` in body) and update (has `id`). Deletes use separate `DELETE` routes or dedicated `/delete` endpoints.

**Recurrence** — events store `recur` (daily/weekly/monthly/yearly/none), `recur_end` (ISO date), `recur_config` (JSON with day-of-week or monthly details), and `recur_exceptions` (JSON array of skipped dates). The frontend in `app.js` is responsible for expanding recurring events into visible occurrences.

**ICS import/export** — `parse_ical()` / `parse_ical_date()` / `parse_rrule()` are pure Python helpers in `app.py`. Import is two-step: `/api/import-ical/preview` returns a list for user review, then `/api/import-ical` bulk-inserts the confirmed events. Imported events are flagged with `imported=1`.

**PMG13 tab** — a shared community board. Posts are submitted as `pending` and must be approved via `/api/posts/<id>/moderate` before appearing to other users. Supports optional image upload to `static/uploads/`.

**Shared calendar** — `/calendar/share/<username>` is a public read-only view of any user's events, rendered via `calendar_shared.html`.
