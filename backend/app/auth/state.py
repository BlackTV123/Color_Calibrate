"""Single-host, multi-worker authentication state; keep the file on persistent private storage."""
from contextlib import contextmanager
import hashlib
import os
import sqlite3
import time
from pathlib import Path

IDLE_SECONDS = 1800
WINDOW_SECONDS = 900
MAX_ATTEMPTS = 5

@contextmanager
def connect():
    path = Path(os.getenv("AUTH_STATE_PATH", str(Path(__file__).resolve().parents[2] / ".auth" / "state.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.execute("PRAGMA busy_timeout=10000")
    db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires REAL NOT NULL, seen REAL NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS attempts (account TEXT NOT NULL, at REAL NOT NULL)")
    db.execute("CREATE INDEX IF NOT EXISTS attempts_account ON attempts(account, at)")
    try:
        with db:
            yield db
    finally:
        db.close()

def identifier(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def register_session(claims):
    now = time.time()
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE expires <= ? OR seen <= ?", (now, now-IDLE_SECONDS))
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (identifier(claims["jti"]), claims["exp"], now))

def validate_session(claims):
    now = time.time()
    with connect() as db:
        cursor = db.execute("UPDATE sessions SET seen=? WHERE id=? AND expires>? AND seen>?",
                            (now, identifier(claims["jti"]), now, now-IDLE_SECONDS))
        return cursor.rowcount == 1

def revoke_session(claims):
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE id=?", (identifier(claims["jti"]),))

def reserve_login(email):
    """Atomically bound concurrent attempts across all workers, even for unknown accounts."""
    now = time.time()
    key = identifier(email)
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM attempts WHERE at<=?", (now-WINDOW_SECONDS,))
        count, oldest = db.execute("SELECT COUNT(*), MIN(at) FROM attempts WHERE account=?", (key,)).fetchone()
        if count >= MAX_ATTEMPTS:
            return max(1, int(oldest+WINDOW_SECONDS-now)+1)
        db.execute("INSERT INTO attempts VALUES (?,?)", (key,now))
    return 0

def clear_login(email):
    with connect() as db:
        db.execute("DELETE FROM attempts WHERE account=?", (identifier(email),))
