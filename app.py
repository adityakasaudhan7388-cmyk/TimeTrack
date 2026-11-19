
from flask import Flask, render_template, request, jsonify
import sqlite3
from datetime import date, datetime, timedelta

app = Flask(__name__)

MAX_BACKLOG_SECONDS = 7 * 60 * 60
BACKLOG_DAYS = 30


# =====================================
# DATABASE CONNECTION
# =====================================

def get_database():
    connection = sqlite3.connect("timetrack.db")
    connection.row_factory = sqlite3.Row
    return connection


# =====================================
# CREATE DATABASE
# =====================================

def create_database():
    connection = get_database()
    cursor = connection.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_text TEXT NOT NULL,
            completed INTEGER DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS timer (
            id INTEGER PRIMARY KEY,
            total_seconds INTEGER DEFAULT 0
        )
    """)

    cursor.execute("""
        INSERT OR IGNORE INTO timer (id, total_seconds)
        VALUES (1, 0)
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_date TEXT NOT NULL UNIQUE,
            planned_seconds INTEGER NOT NULL DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS time_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS backlog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_date TEXT NOT NULL,
            original_seconds INTEGER NOT NULL,
            remaining_seconds INTEGER NOT NULL,
            deadline TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        )
    """)

    connection.commit()
    connection.close()


# =====================================
# CLEAN STUCK SESSION
# =====================================

def clear_stuck_sessions():
    connection = get_database()

    connection.execute("""
        DELETE FROM time_sessions
        WHERE end_time IS NULL
    """)

    connection.commit()
    connection.close()


# =====================================
# BACKLOG SYSTEM
# =====================================

def update_backlog():
    today = date.today()
    today_text = today.isoformat()

    connection = get_database()

    connection.execute(
        "DELETE FROM backlog WHERE plan_date = ?",
        (today_text,)
    )

    connection.execute("""
        UPDATE backlog
        SET status = 'expired'
        WHERE status = 'active' AND deadline < ?
    """, (today_text,))

    plans = connection.execute("""
        SELECT plan_date, planned_seconds
        FROM daily_plans
        WHERE plan_date < ?
        ORDER BY plan_date ASC
    """, (today_text,)).fetchall()

    for plan in plans:

        existing = connection.execute("""
            SELECT id FROM backlog
            WHERE plan_date = ?
        """, (plan["plan_date"],)).fetchone()

        if existing:
            continue

        actual = connection.execute("""
            SELECT COALESCE(SUM(duration_seconds), 0) AS total
            FROM time_sessions
            WHERE session_date = ?
            AND end_time IS NOT NULL
        """, (plan["plan_date"],)).fetchone()["total"]

        planned = plan["planned_seconds"]
        extra_time = max(0, actual - planned)

        old_items = connection.execute("""
            SELECT id, remaining_seconds
            FROM backlog
            WHERE status = 'active'
            ORDER BY deadline ASC, id ASC
        """).fetchall()

        for item in old_items:

            if extra_time <= 0:
                break

            reduction = min(
                item["remaining_seconds"],
                extra_time
            )

            remaining = item["remaining_seconds"] - reduction
            extra_time -= reduction

            status = "completed" if remaining == 0 else "active"

            connection.execute("""
                UPDATE backlog
                SET remaining_seconds = ?, status = ?
                WHERE id = ?
            """, (remaining, status, item["id"]))

        unfinished = max(0, planned - actual)

        active_total = connection.execute("""
            SELECT COALESCE(SUM(remaining_seconds), 0) AS total
            FROM backlog
            WHERE status = 'active'
        """).fetchone()["total"]

        available = max(
            0,
            MAX_BACKLOG_SECONDS - active_total
        )

        accepted = min(unfinished, available)

        if accepted > 0:

            plan_date = date.fromisoformat(plan["plan_date"])

            deadline = (
                plan_date + timedelta(days=BACKLOG_DAYS)
            ).isoformat()

            connection.execute("""
                INSERT INTO backlog (
                    plan_date,
                    original_seconds,
                    remaining_seconds,
                    deadline,
                    status
                )
                VALUES (?, ?, ?, ?, 'active')
            """, (
                plan["plan_date"],
                accepted,
                accepted,
                deadline
            ))

    connection.commit()
    connection.close()


# =====================================
# HOME
# =====================================

@app.route("/")
def home():
    return render_template("index.html")


# =====================================
# TASKS
# =====================================

@app.route("/api/tasks", methods=["GET"])
def get_tasks():

    connection = get_database()

    tasks = connection.execute("""
        SELECT * FROM tasks
        ORDER BY id DESC
    """).fetchall()

    connection.close()

    return jsonify([dict(task) for task in tasks])


@app.route("/api/tasks", methods=["POST"])
def add_task():

    data = request.get_json() or {}
    task_text = data.get("task_text", "").strip()

    if not task_text:
        return jsonify({"error": "Task cannot be empty"}), 400

    connection = get_database()

    cursor = connection.execute("""
        INSERT INTO tasks (task_text)
        VALUES (?)
    """, (task_text,))

    connection.commit()
    task_id = cursor.lastrowid
    connection.close()

    return jsonify({
        "id": task_id,
        "task_text": task_text,
        "completed": 0
    }), 201


@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
def update_task(task_id):

    data = request.get_json() or {}
    completed = 1 if data.get("completed") else 0

    connection = get_database()

    connection.execute("""
        UPDATE tasks
        SET completed = ?
        WHERE id = ?
    """, (completed, task_id))

    connection.commit()
    connection.close()

    return jsonify({"success": True})


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):

    connection = get_database()

    connection.execute("""
        DELETE FROM tasks
        WHERE id = ?
    """, (task_id,))

    connection.commit()
    connection.close()

    return jsonify({"success": True})


# =====================================
# TOTAL TIMER
# =====================================

@app.route("/api/timer", methods=["GET"])
def get_timer():

    connection = get_database()

    timer = connection.execute("""
        SELECT total_seconds
        FROM timer
        WHERE id = 1
    """).fetchone()

    connection.close()

    return jsonify({
        "total_seconds": timer["total_seconds"]
    })


@app.route("/api/timer", methods=["POST"])
def save_timer():

    data = request.get_json() or {}

    try:
        total_seconds = max(
            0,
            int(data.get("total_seconds", 0))
        )
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid timer value"}), 400

    connection = get_database()

    connection.execute("""
        UPDATE timer
        SET total_seconds = ?
        WHERE id = 1
    """, (total_seconds,))

    connection.commit()
    connection.close()

    return jsonify({"success": True})


# =====================================
# DAILY PLAN
# =====================================

@app.route("/api/plan", methods=["POST"])
def save_plan():

    data = request.get_json() or {}

    try:
        planned_hours = float(data.get("planned_hours", 0))
    except (ValueError, TypeError):
        return jsonify({"error": "Enter a valid number"}), 400

    if not 0 <= planned_hours <= 24:
        return jsonify({
            "error": "Enter between 0 and 24 hours"
        }), 400

    planned_seconds = int(planned_hours * 3600)
    today = date.today().isoformat()

    connection = get_database()

    connection.execute("""
        INSERT INTO daily_plans (plan_date, planned_seconds)
        VALUES (?, ?)
        ON CONFLICT(plan_date)
        DO UPDATE SET planned_seconds = excluded.planned_seconds
    """, (today, planned_seconds))

    connection.commit()
    connection.close()

    return jsonify({
        "success": True,
        "planned_hours": planned_hours,
        "plan_date": today
    })


@app.route("/api/plan", methods=["GET"])
def get_plan():

    today = date.today().isoformat()

    connection = get_database()

    plan = connection.execute("""
        SELECT planned_seconds
        FROM daily_plans
        WHERE plan_date = ?
    """, (today,)).fetchone()

    connection.close()

    return jsonify({
        "plan_date": today,
        "planned_seconds": plan["planned_seconds"] if plan else 0
    })


# =====================================
# DAILY PERFORMANCE
# =====================================

@app.route("/api/daily-time", methods=["GET"])
def get_daily_time():

    today = date.today().isoformat()

    connection = get_database()

    result = connection.execute("""
        SELECT COALESCE(SUM(duration_seconds), 0) AS total
        FROM time_sessions
        WHERE session_date = ?
        AND end_time IS NOT NULL
    """, (today,)).fetchone()

    sessions = connection.execute("""
        SELECT id, start_time, end_time, duration_seconds
        FROM time_sessions
        WHERE session_date = ?
        ORDER BY id DESC
    """, (today,)).fetchall()

    connection.close()

    return jsonify({
        "date": today,
        "actual_seconds": result["total"],
        "sessions": [dict(session) for session in sessions]
    })


# =====================================
# WEEKLY GRAPH DATA
# =====================================

@app.route("/api/weekly-time", methods=["GET"])
def get_weekly_time():

    today = date.today()

    # Monday is the first day of the week.
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)

    connection = get_database()

    sessions = connection.execute("""
        SELECT
            session_date,
            COALESCE(SUM(duration_seconds), 0) AS study_seconds
        FROM time_sessions
        WHERE session_date BETWEEN ? AND ?
        AND end_time IS NOT NULL
        GROUP BY session_date
    """, (monday.isoformat(), sunday.isoformat())).fetchall()

    plans = connection.execute("""
        SELECT plan_date, planned_seconds
        FROM daily_plans
        WHERE plan_date BETWEEN ? AND ?
    """, (monday.isoformat(), sunday.isoformat())).fetchall()

    connection.close()

    session_data = {
        row["session_date"]: row["study_seconds"]
        for row in sessions
    }

    plan_data = {
        row["plan_date"]: row["planned_seconds"]
        for row in plans
    }

    days = []

    for i in range(7):
        current_day = monday + timedelta(days=i)
        day_text = current_day.isoformat()

        days.append({
            "date": day_text,
            "label": current_day.strftime("%a"),
            "study_seconds": session_data.get(day_text, 0),
            "planned_seconds": plan_data.get(day_text, 0)
        })

    return jsonify({
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "days": days
    })


# =====================================
# START SESSION
# =====================================

@app.route("/api/sessions/start", methods=["POST"])
def start_session():

    today = date.today().isoformat()
    now = datetime.now().isoformat(timespec="seconds")

    connection = get_database()

    active = connection.execute("""
        SELECT id
        FROM time_sessions
        WHERE end_time IS NULL
        LIMIT 1
    """).fetchone()

    if active:
        connection.close()
        return jsonify({
            "error": "A session is already running"
        }), 400

    cursor = connection.execute("""
        INSERT INTO time_sessions (
            session_date,
            start_time,
            duration_seconds
        )
        VALUES (?, ?, 0)
    """, (today, now))

    session_id = cursor.lastrowid

    connection.commit()
    connection.close()

    return jsonify({
        "success": True,
        "session_id": session_id,
        "start_time": now
    }), 201


# =====================================
# STOP SESSION
# =====================================

@app.route("/api/sessions/stop", methods=["POST"])
def stop_session():

    now = datetime.now()

    connection = get_database()

    session = connection.execute("""
        SELECT id, start_time
        FROM time_sessions
        WHERE end_time IS NULL
        LIMIT 1
    """).fetchone()

    if not session:
        connection.close()
        return jsonify({"error": "No active session"}), 400

    start = datetime.fromisoformat(session["start_time"])

    duration = max(
        0,
        int((now - start).total_seconds())
    )

    connection.execute("""
        UPDATE time_sessions
        SET end_time = ?,
            duration_seconds = ?
        WHERE id = ?
    """, (
        now.isoformat(timespec="seconds"),
        duration,
        session["id"]
    ))

    connection.commit()
    connection.close()

    return jsonify({
        "success": True,
        "duration_seconds": duration
    })


# =====================================
# BACKLOG
# =====================================

@app.route("/api/backlog", methods=["GET"])
def get_backlog():

    update_backlog()

    connection = get_database()

    items = connection.execute("""
        SELECT * FROM backlog
        ORDER BY
        CASE status
            WHEN 'active' THEN 1
            WHEN 'completed' THEN 2
            ELSE 3
        END,
        deadline ASC
    """).fetchall()

    active_total = connection.execute("""
        SELECT COALESCE(SUM(remaining_seconds), 0) AS total
        FROM backlog
        WHERE status = 'active'
    """).fetchone()["total"]

    connection.close()

    return jsonify({
        "items": [dict(item) for item in items],
        "active_seconds": active_total,
        "maximum_seconds": MAX_BACKLOG_SECONDS,
        "deadline_days": BACKLOG_DAYS
    })


# =====================================
# START APPLICATION
# =====================================

if __name__ == "__main__":

    create_database()
    clear_stuck_sessions()

    app.run(debug=True)
