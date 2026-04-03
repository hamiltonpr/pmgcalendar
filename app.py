import re
import os
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for, session

APP_DIR = Path(__file__).parent
DB_PATH = APP_DIR / "data.db"

# ── Seed data ─────────────────────────────────────────────────────────────────
DEFAULT_GOALS = [
    # name, icon, bg_color, ui_type, cal_cat, goal_value, goal_period, period_options, sort_order, description
    ('Temple Attendance', '🏛️', '#EEF2FF', 'counter', '',       1, 'monthly', 'daily,weekly,monthly,bimonthly', 0, 'Times attended'),
    ('Scripture Study',   '📖', '#F0FDF4', 'counter', 'study',  7, 'weekly',  '',                               1, 'Days studied this week'),
    ('Church Attendance', '⛪', '#FFF7ED', 'toggle',  '',       1, 'weekly',  '',                               2, 'Did you attend church this Sunday?'),
    ('Dates',             '💛', '#FFF1F2', 'counter', 'social', 2, 'weekly',  'weekly,monthly',                 3, 'Dates this week'),
    ('Ministering',       '🤝', '#F0FDF4', 'toggle',  'meeting',1, 'monthly', '',                               4, 'Completed ministering this month?'),
    ('Inviting Friends',  '💌', '#F5F3FF', 'counter', 'contact',3, 'weekly',  'daily,weekly,monthly',           5, 'Invitations sent'),
]

DEFAULT_CATEGORIES = [
    # key, name, color, emoji, sort_order
    ('contact', 'Contact',      '#16A34A', '', 0),
    ('class',   'Class',        '#CA8A04', '', 1),
    ('social',  'Social Outing','#9333EA', '', 2),
    ('meeting', 'Meeting',      '#F472B6', '', 3),
    ('study',   'Study / Plan', '#7C3AED', '', 4),
    ('service', 'Service',      '#1D4ED8', '', 5),
    ('wedding', 'Wedding',      '#0284C7', '', 6),
    ('travel',  'Travel',       '#9A3412', '', 7),
    ('meal',    'Meal',         '#B45309', '', 8),
    ('task',    'Task',         '#65A30D', '', 9),
    ('other',   'Other',        '#6B7280', '', 10),
]

DEFAULT_DOT_SETTINGS = {
    'inactivity_days':      '30',
    'dates_for_green':      '2',
    'dot_yellow_label':     'Contact (active)',
    'dot_yellow_color':     '#EAB308',
    'dot_green_label':      '2 dates done',
    'dot_green_color':      '#22C55E',
    'dot_lightblue_label':  'Engaged',
    'dot_lightblue_color':  '#7DD3FC',
    'dot_darkblue_label':   'Married / Family',
    'dot_darkblue_color':   '#1D4ED8',
    'dot_purple_label':     'Platonic friend',
    'dot_purple_color':     '#A855F7',
    'dot_gray_label':       'Inactive',
    'dot_gray_color':       '#9CA3AF',
    'dot_red_label':        'Do not contact',
    'dot_red_color':        '#EF4444',
}

# ── DB helpers ────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE)''')
    c.execute('''CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, user TEXT, title TEXT, start TEXT, end TEXT,
        category TEXT, notes TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY, user TEXT, name TEXT, dot TEXT, notes TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS indicators (
        id INTEGER PRIMARY KEY, user TEXT, week TEXT, name TEXT, value INTEGER DEFAULT 0,
        UNIQUE(user, week, name))''')
    c.execute('''CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY, user TEXT, anon INTEGER DEFAULT 1,
        category TEXT, text TEXT, created TEXT, status TEXT DEFAULT 'pending')''')
    conn.commit()
    conn.close()

def migrate_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # events extra columns
    for col, typedef in [('recur', "TEXT DEFAULT 'none'"), ('recur_end', 'TEXT'),
                          ('person_id', 'INTEGER'), ('imported', 'INTEGER DEFAULT 0'),
                          ('is_backup', 'INTEGER DEFAULT 0'),
                          ('recur_config', 'TEXT'), ('recur_exceptions', 'TEXT'),
                          ('completed', 'INTEGER DEFAULT 0')]:
        try: c.execute(f'ALTER TABLE events ADD COLUMN {col} {typedef}')
        except Exception: pass
    # people extra columns
    for col, typedef in [('met_where', 'TEXT'), ('met_when', 'TEXT'),
                         ('phone', 'TEXT'), ('address', 'TEXT'),
                         ('birthday', 'TEXT'), ('instagram', 'TEXT')]:
        try: c.execute(f'ALTER TABLE people ADD COLUMN {col} {typedef}')
        except Exception: pass
    # posts extra columns
    try: c.execute("ALTER TABLE posts ADD COLUMN status TEXT DEFAULT 'pending'")
    except Exception: pass
    try: c.execute("ALTER TABLE posts ADD COLUMN image TEXT")
    except Exception: pass
    # goals table (full indicator definitions)
    c.execute('''CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY, user TEXT, name TEXT,
        icon TEXT DEFAULT '📋', bg_color TEXT DEFAULT '#F5F5F5',
        ui_type TEXT DEFAULT 'counter', cal_cat TEXT DEFAULT '',
        goal_value INTEGER DEFAULT 1, goal_period TEXT DEFAULT 'weekly',
        period_options TEXT DEFAULT '', sort_order INTEGER DEFAULT 0,
        description TEXT DEFAULT '',
        UNIQUE(user, name))''')
    # goals extra columns (for older DBs missing these)
    for col, typedef in [('icon', "TEXT DEFAULT '📋'"), ('bg_color', "TEXT DEFAULT '#F5F5F5'"),
                          ('ui_type', "TEXT DEFAULT 'counter'"), ('cal_cat', "TEXT DEFAULT ''"),
                          ('goal_value', 'INTEGER DEFAULT 1'), ('goal_period', "TEXT DEFAULT 'weekly'"),
                          ('period_options', "TEXT DEFAULT ''"), ('sort_order', 'INTEGER DEFAULT 0'),
                          ('description', "TEXT DEFAULT ''")]:
        try: c.execute(f'ALTER TABLE goals ADD COLUMN {col} {typedef}')
        except Exception: pass
    # categories table
    c.execute('''CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY, user TEXT, key TEXT, name TEXT,
        color TEXT DEFAULT '#6B7280', emoji TEXT DEFAULT '', sort_order INTEGER DEFAULT 0)''')
    # categories extra columns
    for col, typedef in [('emoji', "TEXT DEFAULT ''"), ('sort_order', 'INTEGER DEFAULT 0')]:
        try: c.execute(f'ALTER TABLE categories ADD COLUMN {col} {typedef}')
        except Exception: pass
    # dot_history table
    c.execute('''CREATE TABLE IF NOT EXISTS dot_history (
        id INTEGER PRIMARY KEY, user TEXT, person_id INTEGER,
        from_dot TEXT, to_dot TEXT, changed_at TEXT)''')
    # dot_settings table
    c.execute('''CREATE TABLE IF NOT EXISTS dot_settings (
        id INTEGER PRIMARY KEY, user TEXT, key TEXT, value TEXT,
        UNIQUE(user, key))''')
    # comments table
    c.execute('''CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY, post_id INTEGER, user TEXT,
        text TEXT, created TEXT)''')
    # rename old category keys to new ones (data migration)
    for old_key, new_key in [('dates', 'social'), ('eating', 'meal'), ('work', 'service')]:
        try: c.execute('UPDATE events SET category=? WHERE category=?', (new_key, old_key))
        except Exception: pass
        try: c.execute('UPDATE categories SET key=? WHERE key=?', (new_key, old_key))
        except Exception: pass
    conn.commit()
    conn.close()

def db_query(query, args=(), one=False):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(query, args)
    rv = cur.fetchall()
    conn.commit()
    conn.close()
    return (rv[0] if rv else None) if one else rv

def slugify(text):
    return re.sub(r'[^a-z0-9_]', '', text.lower().replace(' ', '_'))[:30]

def week_monday(dt=None):
    if dt is None:
        dt = datetime.utcnow()
    monday = dt - timedelta(days=dt.weekday())
    return monday.strftime('%Y-%m-%d')

# ── Seeding ───────────────────────────────────────────────────────────────────
def seed_goals(user):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    for i, row in enumerate(DEFAULT_GOALS):
        name, icon, bg, ui, cal, gv, gp, opts, so, desc = row
        c.execute(
            'INSERT OR IGNORE INTO goals(user,name,icon,bg_color,ui_type,cal_cat,goal_value,goal_period,period_options,sort_order,description) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            (user, name, icon, bg, ui, cal, gv, gp, opts, so, desc)
        )
    conn.commit()
    conn.close()

def seed_categories(user):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    for row in DEFAULT_CATEGORIES:
        key, name, color, emoji, so = row
        existing = c.execute('SELECT id FROM categories WHERE user=? AND key=?', (user, key)).fetchone()
        if existing:
            c.execute('UPDATE categories SET name=?,color=?,sort_order=? WHERE user=? AND key=?',
                      (name, color, so, user, key))
        else:
            c.execute('INSERT INTO categories(user,key,name,color,emoji,sort_order) VALUES(?,?,?,?,?,?)',
                      (user, key, name, color, emoji, so))
    conn.commit()
    conn.close()

def seed_dot_settings(user):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    for key, value in DEFAULT_DOT_SETTINGS.items():
        c.execute(
            'INSERT OR IGNORE INTO dot_settings(user,key,value) VALUES(?,?,?)',
            (user, key, value)
        )
    conn.commit()
    conn.close()

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = "dev-secret"

def setup():
    init_db()
    migrate_db()

try:
    app.before_first_request(setup)
except Exception:
    try:
        app.before_serving(setup)
    except Exception:
        setup()

def require_user():
    return session.get('user', 'demo')

# ── Auth routes ───────────────────────────────────────────────────────────────
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username') or 'demo'
        db_query('INSERT OR IGNORE INTO users(username) VALUES (?)', (username,))
        session['user'] = username
        return redirect(url_for('home'))
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))

@app.route('/')
def root():
    if 'user' not in session:
        return redirect(url_for('login'))
    return redirect(url_for('home'))

# ── Page routes ───────────────────────────────────────────────────────────────
@app.route('/home')
def home():
    return render_template('home.html', user=require_user())

@app.route('/calendar')
def calendar():
    return render_template('calendar.html', user=require_user())

@app.route('/people')
def people():
    return render_template('people.html', user=require_user())

@app.route('/pmg13')
def pmg13():
    return render_template('pmg13.html', user=require_user())

@app.route('/settings')
def settings():
    return render_template('settings.html', user=require_user())

# ── Goals API (indicator definitions + goal config) ───────────────────────────
@app.route('/api/goals', methods=['GET', 'POST'])
def api_goals():
    user = require_user()
    if request.method == 'GET':
        rows = db_query('SELECT * FROM goals WHERE user=? ORDER BY sort_order', (user,))
        if not rows:
            seed_goals(user)
            rows = db_query('SELECT * FROM goals WHERE user=? ORDER BY sort_order', (user,))
        return jsonify([dict(r) for r in rows])
    data = request.json
    gid = data.get('id')
    if gid:
        db_query(
            'UPDATE goals SET name=?,icon=?,bg_color=?,ui_type=?,cal_cat=?,goal_value=?,goal_period=?,period_options=?,description=? WHERE id=? AND user=?',
            (data.get('name'), data.get('icon','📋'), data.get('bg_color','#F5F5F5'),
             data.get('ui_type','counter'), data.get('cal_cat','') or '',
             int(data.get('goal_value',1)), data.get('goal_period','weekly'),
             data.get('period_options','') or '', data.get('description',''),
             gid, user)
        )
        return jsonify({'status': 'updated'})
    # Create new
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('SELECT MAX(sort_order) FROM goals WHERE user=?', (user,))
    so = cur.fetchone()[0] or 0
    cur.execute(
        'INSERT INTO goals(user,name,icon,bg_color,ui_type,cal_cat,goal_value,goal_period,period_options,sort_order,description) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        (user, data.get('name','New Goal'), data.get('icon','📋'), data.get('bg_color','#F5F5F5'),
         data.get('ui_type','counter'), data.get('cal_cat','') or '',
         int(data.get('goal_value',1)), data.get('goal_period','weekly'),
         data.get('period_options','') or '', int(so)+1, data.get('description',''))
    )
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'status': 'created', 'id': new_id})

@app.route('/api/goals/<int:gid>', methods=['DELETE'])
def api_goal_delete(gid):
    db_query('DELETE FROM goals WHERE id=? AND user=?', (gid, require_user()))
    return jsonify({'status': 'deleted'})

@app.route('/api/goals/reset', methods=['POST'])
def api_goals_reset():
    user = require_user()
    db_query('DELETE FROM goals WHERE user=?', (user,))
    seed_goals(user)
    rows = db_query('SELECT * FROM goals WHERE user=? ORDER BY sort_order', (user,))
    return jsonify([dict(r) for r in rows])

# ── Indicators API (per-week values) ──────────────────────────────────────────
@app.route('/api/indicators', methods=['GET', 'POST'])
def api_indicators():
    user = require_user()
    if request.method == 'GET':
        week = request.args.get('week', week_monday())
        rows = db_query('SELECT name, value FROM indicators WHERE user=? AND week=?', (user, week))
        return jsonify({'week': week, 'values': {r['name']: r['value'] for r in rows}})
    data = request.json
    week  = data.get('week', week_monday())
    name  = data.get('name')
    value = int(data.get('value', 0))
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO indicators(user,week,name,value) VALUES(?,?,?,?) ON CONFLICT(user,week,name) DO UPDATE SET value=excluded.value',
        (user, week, name, value)
    )
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})

# ── Categories API ────────────────────────────────────────────────────────────
@app.route('/api/categories', methods=['GET', 'POST'])
def api_categories():
    user = require_user()
    if request.method == 'GET':
        seed_categories(user)  # INSERT OR IGNORE — adds any missing defaults safely
        rows = db_query('SELECT * FROM categories WHERE user=? ORDER BY sort_order', (user,))
        return jsonify([dict(r) for r in rows])
    data = request.json
    cid  = data.get('id')
    name = data.get('name', '').strip()
    if cid:
        db_query('UPDATE categories SET name=?,color=?,emoji=? WHERE id=? AND user=?',
                 (name, data.get('color','#6B7280'), data.get('emoji',''), cid, user))
        return jsonify({'status': 'updated'})
    key = slugify(name) or 'custom'
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('SELECT MAX(sort_order) FROM categories WHERE user=?', (user,))
    so = cur.fetchone()[0] or 0
    cur.execute('INSERT INTO categories(user,key,name,color,emoji,sort_order) VALUES(?,?,?,?,?,?)',
                (user, key, name, data.get('color','#6B7280'), data.get('emoji',''), int(so)+1))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'status': 'created', 'id': new_id})

@app.route('/api/categories/<int:cid>', methods=['DELETE'])
def api_category_delete(cid):
    db_query('DELETE FROM categories WHERE id=? AND user=?', (cid, require_user()))
    return jsonify({'status': 'deleted'})

# ── Dot settings API ──────────────────────────────────────────────────────────
@app.route('/api/dot-settings', methods=['GET', 'POST'])
def api_dot_settings():
    user = require_user()
    if request.method == 'GET':
        rows = db_query('SELECT key, value FROM dot_settings WHERE user=?', (user,))
        if not rows:
            seed_dot_settings(user)
            rows = db_query('SELECT key, value FROM dot_settings WHERE user=?', (user,))
        return jsonify({r['key']: r['value'] for r in rows})
    data = request.json  # dict of key:value
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    for key, value in data.items():
        cur.execute(
            'INSERT INTO dot_settings(user,key,value) VALUES(?,?,?) ON CONFLICT(user,key) DO UPDATE SET value=excluded.value',
            (user, key, str(value))
        )
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})

# ── Events API ────────────────────────────────────────────────────────────────
@app.route('/api/events', methods=['GET', 'POST', 'DELETE'])
def api_events():
    user = require_user()
    if request.method == 'GET':
        rows = db_query('SELECT * FROM events WHERE user=?', (user,))
        return jsonify([dict(r) for r in rows])
    if request.method == 'POST':
        data = request.json
        eid       = data.get('id')
        recur     = data.get('recur', 'none') or 'none'
        recur_end    = data.get('recur_end') or None
        person_id    = data.get('person_id') or None
        is_backup    = 1 if data.get('is_backup') else 0
        recur_config = data.get('recur_config') or None
        completed    = 1 if data.get('completed') else 0
        if eid:
            db_query(
                'UPDATE events SET title=?,start=?,end=?,category=?,notes=?,recur=?,recur_end=?,person_id=?,is_backup=?,recur_config=?,completed=? WHERE id=? AND user=?',
                (data.get('title'), data.get('start'), data.get('end'), data.get('category'),
                 data.get('notes'), recur, recur_end, person_id, is_backup, recur_config, completed, eid, user)
            )
            return jsonify({'status': 'updated'})
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute(
            'INSERT INTO events(user,title,start,end,category,notes,recur,recur_end,person_id,is_backup,recur_config,completed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (user, data.get('title'), data.get('start'), data.get('end'), data.get('category'),
             data.get('notes'), recur, recur_end, person_id, is_backup, recur_config, completed)
        )
        last_id = cur.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'status': 'created', 'id': last_id})
    if request.method == 'DELETE':
        eid = request.args.get('id')
        db_query('DELETE FROM events WHERE id=? AND user=?', (eid, user))
        return jsonify({'status': 'deleted'})

# ── People API ────────────────────────────────────────────────────────────────
@app.route('/api/people', methods=['GET', 'POST'])
def api_people():
    user = require_user()
    if request.method == 'GET':
        rows = db_query('SELECT * FROM people WHERE user=?', (user,))
        return jsonify([dict(r) for r in rows])
    data = request.json
    pid  = data.get('id')
    if pid:
        old = db_query('SELECT dot FROM people WHERE id=? AND user=?', (pid, user), one=True)
        new_dot = data.get('dot', 'yellow')
        if old and old['dot'] != new_dot:
            db_query('INSERT INTO dot_history(user,person_id,from_dot,to_dot,changed_at) VALUES(?,?,?,?,?)',
                     (user, pid, old['dot'], new_dot, datetime.utcnow().isoformat()))
        db_query('UPDATE people SET dot=?,notes=?,met_where=?,met_when=?,phone=?,address=?,birthday=?,instagram=? WHERE id=? AND user=?',
                 (new_dot, data.get('notes',''), data.get('met_where',''), data.get('met_when',''),
                  data.get('phone',''), data.get('address',''), data.get('birthday',''),
                  data.get('instagram',''), pid, user))
        return jsonify({'status': 'updated'})
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('INSERT INTO people(user,name,dot,notes,met_where,met_when,phone,address,birthday,instagram) VALUES(?,?,?,?,?,?,?,?,?,?)',
                (user, data.get('name'), data.get('dot','yellow'), data.get('notes',''),
                 data.get('met_where',''), data.get('met_when',''),
                 data.get('phone',''), data.get('address',''), data.get('birthday',''), data.get('instagram','')))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok', 'id': new_id})

@app.route('/api/people/<int:pid>', methods=['DELETE'])
def api_person_delete(pid):
    db_query('DELETE FROM people WHERE id=? AND user=?', (pid, require_user()))
    return jsonify({'status': 'deleted'})

@app.route('/api/people/<int:pid>/dot-history', methods=['GET'])
def api_person_dot_history(pid):
    user = require_user()
    rows = db_query('SELECT * FROM dot_history WHERE user=? AND person_id=? ORDER BY changed_at ASC', (user, pid))
    return jsonify([dict(r) for r in rows])

UPLOAD_DIR = APP_DIR / 'static' / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)
ALLOWED_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}

# ── Posts API (PMG13) ─────────────────────────────────────────────────────────
@app.route('/api/posts', methods=['GET', 'POST'])
def api_posts():
    user = require_user()
    if request.method == 'GET':
        sort = request.args.get('sort', 'newest')  # newest | oldest | category
        status_filter = request.args.get('status', 'approved')
        base = 'SELECT * FROM posts WHERE status=?'
        order = {'newest': 'ORDER BY id DESC', 'oldest': 'ORDER BY id ASC',
                 'category': 'ORDER BY category, id DESC'}.get(sort, 'ORDER BY id DESC')
        rows = db_query(f'{base} {order}', (status_filter,))
        return jsonify([dict(r) for r in rows])
    # POST — multipart form data (supports optional image upload)
    anon = 1 if request.form.get('anon', 'true').lower() in ('true','1','on') else 0
    image_path = None
    if 'image' in request.files:
        f = request.files['image']
        if f and f.filename:
            ext = os.path.splitext(f.filename)[1].lower()
            if ext in ALLOWED_EXTS:
                fname = f'{datetime.utcnow().strftime("%Y%m%d%H%M%S%f")}_{user}{ext}'
                f.save(UPLOAD_DIR / fname)
                image_path = f'/static/uploads/{fname}'
    db_query('INSERT INTO posts(user,anon,category,text,created,status,image) VALUES(?,?,?,?,?,?,?)',
             (user, anon, request.form.get('category','misc'), request.form.get('text'),
              datetime.utcnow().isoformat(), 'pending', image_path))
    return jsonify({'status': 'ok'})

@app.route('/api/posts/<int:pid>/moderate', methods=['POST'])
def api_post_moderate(pid):
    user = require_user()
    action = request.json.get('action')  # 'approve' or 'reject'
    if action == 'approve':
        db_query('UPDATE posts SET status=? WHERE id=?', ('approved', pid))
    elif action == 'reject':
        db_query('DELETE FROM posts WHERE id=?', (pid,))
    return jsonify({'status': 'ok'})

# ── Comments API ──────────────────────────────────────────────────────────────
@app.route('/api/comments', methods=['GET', 'POST'])
def api_comments():
    user = require_user()
    if request.method == 'GET':
        post_id = request.args.get('post_id')
        rows = db_query('SELECT * FROM comments WHERE post_id=? ORDER BY id ASC', (post_id,))
        return jsonify([dict(r) for r in rows])
    data = request.json
    db_query('INSERT INTO comments(post_id,user,text,created) VALUES(?,?,?,?)',
             (data.get('post_id'), user, data.get('text'), datetime.utcnow().isoformat()))
    return jsonify({'status': 'ok'})

# ── Google Calendar (.ics) Import ─────────────────────────────────────────────
def parse_ical(content):
    """Parse .ics content. Returns (events, cal_name).
    Each event is a dict with keys like SUMMARY, DTSTART, DTSTART_PARAMS, DTEND,
    DTEND_PARAMS, DESCRIPTION, LOCATION, RRULE, CATEGORIES.
    """
    lines = content.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    # Unfold continuation lines
    unfolded = []
    for line in lines:
        if line.startswith((' ', '\t')) and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)

    events, current, cal_name = [], None, ''
    for line in unfolded:
        stripped = line.strip()
        if stripped == 'BEGIN:VEVENT':
            current = {}
        elif stripped == 'END:VEVENT' and current is not None:
            events.append(current)
            current = None
        elif ':' in stripped:
            prop, _, value = stripped.partition(':')
            value = value  # keep original casing for values
            parts = prop.split(';')
            key_base = parts[0].upper()
            params = {}
            for p in parts[1:]:
                if '=' in p:
                    pk, pv = p.split('=', 1)
                    params[pk.upper()] = pv.upper()
            if current is not None:
                # Don't overwrite — first occurrence wins (handles DTSTART before recurrence exceptions)
                if key_base not in current:
                    current[key_base] = value
                if params and (key_base + '_PARAMS') not in current:
                    current[key_base + '_PARAMS'] = params
            elif key_base == 'X-WR-CALNAME':
                cal_name = value
    return events, cal_name

def parse_ical_date(value, params=None, tz_offset_min=0):
    """Parse an ical date/datetime string.
    Returns (iso_string, is_allday).
    tz_offset_min: minutes west of UTC (e.g. Mountain Standard = 420).
    Applies offset only to UTC-marked datetimes (Z suffix).
    """
    if not value:
        return None, False
    is_allday = params and params.get('VALUE') == 'DATE'
    is_utc = value.endswith('Z')
    clean = value.rstrip('Z').strip()
    try:
        if 'T' in clean:
            dt = datetime.strptime(clean[:15], '%Y%m%dT%H%M%S')
            if is_utc:
                dt = dt - timedelta(minutes=tz_offset_min)
            return dt.isoformat(), False
        else:
            # Date-only = all-day
            dt = datetime.strptime(clean[:8], '%Y%m%d')
            return dt.strftime('%Y-%m-%d'), True
    except Exception:
        return None, False

def _apply_duration(start_iso, dur_str, is_allday):
    """Apply an iCal DURATION string to a start ISO date/datetime, return end ISO string."""
    import re as _re
    m = _re.match(r'P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?', dur_str or '')
    if not m:
        return None
    weeks = int(m.group(1) or 0)
    days  = int(m.group(2) or 0)
    hours = int(m.group(3) or 0)
    mins  = int(m.group(4) or 0)
    secs  = int(m.group(5) or 0)
    total_days = weeks * 7 + days
    total_secs = hours * 3600 + mins * 60 + secs
    try:
        if is_allday:
            dt = datetime.strptime(start_iso[:10], '%Y-%m-%d')
            dt += timedelta(days=total_days)
            return dt.strftime('%Y-%m-%d')
        else:
            dt = datetime.fromisoformat(start_iso)
            dt += timedelta(days=total_days, seconds=total_secs)
            return dt.isoformat()
    except Exception:
        return None

def parse_rrule(rrule_str):
    """Extract (recur_type, recur_end, recur_config_json) from RRULE string."""
    import json as _json
    if not rrule_str:
        return 'none', None, None
    parts = {k: v for k, v in (p.split('=', 1) for p in rrule_str.split(';') if '=' in p)}
    freq_map = {'DAILY': 'daily', 'WEEKLY': 'weekly', 'MONTHLY': 'monthly', 'YEARLY': 'yearly'}
    recur = freq_map.get(parts.get('FREQ', ''), 'none')
    recur_end = None
    if 'UNTIL' in parts:
        try:
            until = parts['UNTIL'].rstrip('Z')[:8]
            recur_end = datetime.strptime(until, '%Y%m%d').strftime('%Y-%m-%d')
        except Exception:
            pass
    # Parse BYDAY into recur_config
    ics_day = {'SU':0,'MO':1,'TU':2,'WE':3,'TH':4,'FR':5,'SA':6}
    recur_config = None
    if recur == 'weekly' and 'BYDAY' in parts:
        days = []
        for d in parts['BYDAY'].upper().split(','):
            d = d.strip()
            if d in ics_day:
                days.append(ics_day[d])
        if days:
            recur_config = _json.dumps({'days': sorted(days)})
    elif recur == 'monthly':
        if 'BYDAY' in parts:
            m = re.match(r'^(-?\d+)([A-Z]{2})$', parts['BYDAY'].strip().upper())
            if m and m.group(2) in ics_day:
                recur_config = _json.dumps({'type':'weekday','n':int(m.group(1)),'day':ics_day[m.group(2)]})
            else:
                recur_config = _json.dumps({'type':'date'})
        else:
            recur_config = _json.dumps({'type':'date'})
    return recur, recur_end, recur_config

@app.route('/api/import-ical/preview', methods=['POST'])
def api_ical_preview():
    """Parse file, return full event list for user review before import."""
    user = require_user()
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    content = request.files['file'].read().decode('utf-8', errors='replace')
    tz_offset = int(request.form.get('tz_offset', 0))
    raw_events, cal_name = parse_ical(content)

    # Fetch existing events for duplicate detection
    existing = db_query('SELECT title, start FROM events WHERE user=?', (user,))
    existing_keys = set()
    for e in existing:
        if e['start']:
            existing_keys.add((e['title'] or '').lower().strip() + '|' + e['start'][:10])

    now = datetime.utcnow().date()
    result = []
    for i, ev in enumerate(raw_events):
        # Skip cancelled/deleted events
        if ev.get('STATUS', '').upper() in ('CANCELLED', 'CANCELED'):
            continue

        start_params = ev.get('DTSTART_PARAMS', {})
        end_params   = ev.get('DTEND_PARAMS', {})
        start, is_allday = parse_ical_date(ev.get('DTSTART', ''), start_params, tz_offset)
        end, _           = parse_ical_date(ev.get('DTEND', ''),   end_params,   tz_offset)
        if not end and ev.get('DURATION'):
            end = _apply_duration(start, ev['DURATION'], is_allday)
        if not start:
            continue

        recur, recur_end, recur_config = parse_rrule(ev.get('RRULE', ''))

        # For recurring events: skip if recur_end is in the past
        if recur != 'none' and recur_end:
            try:
                if datetime.strptime(recur_end, '%Y-%m-%d').date() < now:
                    continue
            except Exception:
                pass

        # Skip non-recurring past events
        try:
            event_date = datetime.fromisoformat(start[:10]).date()
            if event_date < now and recur == 'none':
                continue
        except Exception:
            pass
        title = ev.get('SUMMARY', '(imported)').strip() or '(imported)'
        src_cats = [c.strip() for c in ev.get('CATEGORIES', '').split(',') if c.strip()]
        duplicate = False
        key = title.lower().strip() + '|' + start[:10]
        duplicate = key in existing_keys
        result.append({
            'idx': i,
            'title': title,
            'start': start,
            'end': end,
            'is_allday': is_allday,
            'src_cats': src_cats,
            'location': ev.get('LOCATION', ''),
            'description': ev.get('DESCRIPTION', ''),
            'recur': recur,
            'recur_end': recur_end,
            'recur_config': recur_config,
            'duplicate': duplicate,
        })
    return jsonify({'events': result, 'cal_name': cal_name})

@app.route('/api/import-ical', methods=['POST'])
def api_import_ical():
    """Accept reviewed event list from frontend and bulk-insert."""
    import json as _json
    user = require_user()
    try:
        events_json = _json.loads(request.form.get('events_json', '[]'))
    except Exception:
        return jsonify({'error': 'Invalid event data'}), 400

    imported = 0
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    for ev in events_json:
        title    = (ev.get('title') or '(imported)').strip()
        start    = ev.get('start')
        end      = ev.get('end') or None
        category = ev.get('category') or 'class'
        notes_parts = []
        if ev.get('description'):
            notes_parts.append(ev['description'])
        if ev.get('location'):
            notes_parts.append('📍 ' + ev['location'])
        notes    = '\n'.join(notes_parts)
        recur        = ev.get('recur', 'none')
        recur_end    = ev.get('recur_end') or None
        recur_config = ev.get('recur_config') or None
        is_backup    = 1 if ev.get('is_backup') else 0
        if not start:
            continue
        cur.execute(
            'INSERT INTO events(user,title,start,end,category,notes,recur,recur_end,recur_config,is_backup,imported) VALUES(?,?,?,?,?,?,?,?,?,?,1)',
            (user, title, start, end, category, notes, recur, recur_end, recur_config, is_backup)
        )
        imported += 1
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok', 'imported': imported})

@app.route('/api/import-ical/delete', methods=['POST'])
def api_ical_delete():
    """Delete all imported events for the user."""
    user = require_user()
    # Count events flagged as imported OR (legacy: no person_id and category='class' — the old default)
    try:
        row = db_query('SELECT COUNT(*) as c FROM events WHERE user=? AND imported=1', (user,), one=True)
        count = row['c'] if row else 0
        db_query('DELETE FROM events WHERE user=? AND imported=1', (user,))
    except Exception:
        count = 0
    return jsonify({'status': 'ok', 'deleted': count})

@app.route('/api/export-ical')
def api_export_ical():
    """Export all events as an .ics file compatible with Google Calendar."""
    user = require_user()
    rows = db_query('SELECT * FROM events WHERE user=?', (user,))
    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//LiveMyGospel//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        f'X-WR-CALNAME:Live My Gospel — {user}',
    ]
    freq_map = {'daily':'DAILY','weekly':'WEEKLY','monthly':'MONTHLY','yearly':'YEARLY'}
    for r in rows:
        start = r['start'] or ''
        end   = r['end'] or ''
        def fmt_dt(s):
            if not s: return ''
            s = s.replace('-','').replace(':','').replace(' ','T')
            if 'T' in s: return s[:15]
            return s[:8]
        start_val = fmt_dt(start)
        end_val   = fmt_dt(end) or start_val
        if 'T' in start_val:
            dtstart = f'DTSTART:{start_val}'
            dtend   = f'DTEND:{end_val}'
        else:
            dtstart = f'DTSTART;VALUE=DATE:{start_val}'
            dtend   = f'DTEND;VALUE=DATE:{end_val}'
        lines += ['BEGIN:VEVENT',
                  f'UID:{r["id"]}@livemygospel',
                  f'SUMMARY:{(r["title"] or "").replace(chr(10)," ")}',
                  dtstart, dtend]
        if r['notes']:
            lines.append('DESCRIPTION:' + r['notes'].replace('\n','\\n'))
        recur = r['recur'] if r['recur'] else 'none'
        if recur != 'none' and recur in freq_map:
            rrule = f'RRULE:FREQ={freq_map[recur]}'
            if r['recur_end']:
                until = r['recur_end'].replace('-','') + 'T000000Z'
                rrule += f';UNTIL={until}'
            lines.append(rrule)
        lines.append('END:VEVENT')
    lines.append('END:VCALENDAR')
    ics_content = '\r\n'.join(lines) + '\r\n'
    from flask import Response
    return Response(ics_content, mimetype='text/calendar',
                    headers={'Content-Disposition': 'attachment; filename="livemygospel.ics"'})

@app.route('/calendar/share/<username>')
def shared_calendar(username):
    """Public read-only view of a user's calendar."""
    rows = db_query('SELECT * FROM events WHERE user=?', (username,))
    events = [dict(r) for r in rows]
    return render_template('calendar_shared.html', events=events, username=username)

@app.route('/api/events/<int:eid>/exception', methods=['POST'])
def api_event_exception(eid):
    """Add a specific date to a recurring event's exceptions list."""
    import json as _json
    user = require_user()
    date = request.json.get('date')
    if not date:
        return jsonify({'error': 'date required'}), 400
    row = db_query('SELECT recur_exceptions FROM events WHERE id=? AND user=?', (eid, user), one=True)
    if not row:
        return jsonify({'error': 'not found'}), 404
    try:
        exceptions = _json.loads(row['recur_exceptions'] or '[]')
    except Exception:
        exceptions = []
    if date not in exceptions:
        exceptions.append(date)
    db_query('UPDATE events SET recur_exceptions=? WHERE id=? AND user=?',
             (_json.dumps(exceptions), eid, user))
    return jsonify({'status': 'ok'})

@app.route('/api/events/delete-all', methods=['POST'])
def api_events_delete_all():
    user = require_user()
    row = db_query('SELECT COUNT(*) as c FROM events WHERE user=?', (user,), one=True)
    count = row['c'] if row else 0
    db_query('DELETE FROM events WHERE user=?', (user,))
    return jsonify({'status': 'ok', 'deleted': count})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')
