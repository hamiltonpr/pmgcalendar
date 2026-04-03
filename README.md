# Live My Gospel — Local Demo

Run locally (Windows):

1. Create and activate a Python venv:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Run the app:

```powershell
python app.py
```

3. Open http://127.0.0.1:5000 in your browser. Sign in with any username.

This is a minimal local prototype matching the PRD's core ideas: a familiar calendar, weekly indicators, a People list with dots, and a PMG13 tab for shared content. It's intentionally simple for local development — we can add auth, syncing, and more dot rules next.
