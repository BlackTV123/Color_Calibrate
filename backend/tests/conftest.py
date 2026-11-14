"""All auth tests use a private temporary session store and a test-only signing key."""
import os
import secrets
import pytest

os.environ["JWT_SECRET"] = secrets.token_hex(48)
os.environ["AUTH_ENV"] = "development"

@pytest.fixture(autouse=True)
def isolated_auth_state(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_STATE_PATH", str(tmp_path / "auth.sqlite3"))
    from app.middleware import _request_records
    _request_records.clear()
