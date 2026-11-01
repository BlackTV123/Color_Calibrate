import hashlib
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import jwt
import pytest
from fastapi.testclient import TestClient

from app import main as api
from app.auth import security, state
from app.auth.password_policy import PasswordCheckUnavailable, check_new_password

PASSWORD = "a unique test passphrase 428!"
WRITE = {"X-Requested-With": "BruiseWeb"}

@pytest.fixture
def client(monkeypatch):
    user = SimpleNamespace(id=7, email="owner@example.test", name="Owner",
                           role="Clinician", org="Lab", passwordHash=security.hash_password(PASSWORD))
    database = SimpleNamespace(is_connected=Mock(return_value=True), user=SimpleNamespace(
        find_unique=AsyncMock(return_value=user), create=AsyncMock(return_value=user),
        update=AsyncMock(return_value=user), upsert=AsyncMock()))
    monkeypatch.setattr(api, "db", database)
    monkeypatch.setattr(api, "check_new_password", lambda password: None)
    return TestClient(api.app), database, user

def signin(client, password=PASSWORD):
    return client.post("/api/auth/login", headers=WRITE,
                       json={"email": "owner@example.test", "password": password})

def test_empty_hash_cannot_login(client):
    c, db, user = client
    user.passwordHash = ""
    response = signin(c)
    assert response.status_code == 401
    assert not c.cookies.get(security.COOKIE_NAME)
    db.user.update.assert_not_awaited()

def test_missing_and_wrong_credentials_return_identical_error(client):
    c, db, _ = client
    wrong = signin(c, "wrong")
    db.user.find_unique.return_value = None
    absent = signin(c, "wrong")
    assert wrong.status_code == absent.status_code == 401
    assert wrong.json() == absent.json()

@pytest.mark.parametrize("method", ["get", "put"])
@pytest.mark.parametrize("auth", [None, "Bearer invalid"])
def test_profile_requires_valid_account(client, method, auth):
    c, db, _ = client
    options = {"json": {"name": "Intruder", "email": "victim@example.test"}} if method == "put" else {}
    headers = {**WRITE, **({"Authorization": auth} if auth else {})}
    r = c.request(method.upper(), "/api/profile?email=victim@example.test", headers=headers, **options)
    assert r.status_code == 401
    db.user.upsert.assert_not_awaited()
    db.user.update.assert_not_awaited()
    db.user.find_unique.assert_not_awaited()

def test_profile_only_updates_authenticated_display_name(client):
    c, db, _ = client
    assert signin(c).status_code == 200
    db.user.find_unique.reset_mock()
    r = c.put("/api/profile", headers=WRITE, json={"name": "New name", "email": "victim@example.test",
                                                "role": "Admin", "org": "Attacker"})
    assert r.status_code == 200
    db.user.find_unique.assert_awaited_once_with(where={"id": 7})
    db.user.update.assert_awaited_once_with(where={"id": 7}, data={"name": "New name"})
    db.user.upsert.assert_not_awaited()

def test_legacy_password_is_upgraded_on_success(client):
    c, db, user = client
    user.passwordHash = hashlib.sha256((PASSWORD+"bcc_clinical_salt_2026").encode()).hexdigest()
    assert signin(c).status_code == 200
    new_hash = db.user.update.await_args.kwargs["data"]["passwordHash"]
    assert new_hash.startswith("$argon2id$")
    assert security.verify_password(PASSWORD, new_hash)

def test_cookie_is_httponly_and_response_contains_no_token(client):
    c, _, _ = client
    r = signin(c)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert "access_token" not in r.json()
    assert c.get("/api/auth/me").status_code == 200

def test_logout_revokes_a_copied_cookie_token(client):
    c, _, _ = client
    signin(c)
    token = c.cookies.get(security.COOKIE_NAME)
    assert c.post("/api/auth/logout", headers=WRITE).status_code == 200
    assert not c.cookies.get(security.COOKIE_NAME)
    assert c.get("/api/auth/me", headers={"Authorization": "Bearer "+token}).status_code == 401

def test_session_idle_timeout(client):
    c, _, _ = client
    signin(c)
    with state.connect() as db:
        db.execute("UPDATE sessions SET seen=?", (time.time()-state.IDLE_SECONDS-1,))
    assert c.get("/api/auth/me").status_code == 401

@pytest.mark.parametrize("headers", [{}, {"X-Requested-With": "BruiseWeb", "Origin": "https://other.example"}])
def test_cross_site_login_is_rejected(client, headers):
    c, db, _ = client
    assert c.post("/api/auth/login", headers=headers,
                  json={"email": "owner@example.test", "password": PASSWORD}).status_code == 403
    db.user.find_unique.assert_not_awaited()

def test_cookie_write_requires_csrf_header(client):
    c, db, _ = client
    signin(c)
    assert c.put("/api/profile", json={"name": "Intruder"}).status_code == 403
    db.user.update.assert_not_awaited()

def test_production_requires_https_and_secure_cookie(client, monkeypatch):
    c, _, _ = client
    monkeypatch.setattr(security, "COOKIE_SECURE", True)
    monkeypatch.setattr(api, "COOKIE_SECURE", True)
    assert signin(c).status_code == 400
    c = TestClient(api.app, base_url="https://testserver")
    r = signin(c)
    assert r.status_code == 200 and "secure" in r.headers["set-cookie"].lower()

def test_account_throttle_survives_changing_forwarded_ip(client, caplog):
    c, _, _ = client
    for i in range(state.MAX_ATTEMPTS):
        r = c.post("/api/auth/login", headers={**WRITE, "X-Forwarded-For": f"192.0.2.{i}"},
                   json={"email": " OWNER@example.test ", "password": "wrong"})
        assert r.status_code == 401
    r = signin(c)
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert "auth_login_failed" in caplog.text and "auth_login_throttled" in caplog.text
    assert PASSWORD not in caplog.text and "owner@example.test" not in caplog.text

def test_throttle_recovers_after_window(client, monkeypatch):
    c, _, _ = client
    for _ in range(state.MAX_ATTEMPTS):
        signin(c, "wrong")
    assert signin(c).status_code == 429
    with state.connect() as db:
        db.execute("UPDATE attempts SET at=?", (time.time()-state.WINDOW_SECONDS-1,))
    assert signin(c).status_code == 200

@pytest.mark.parametrize("password", ["short", "x"*129, 123, None])
def test_registration_rejects_invalid_password_before_db(client, password):
    c, db, _ = client
    assert c.post("/api/auth/register", headers=WRITE,
                  json={"email": "new@gmail.com", "name": "New", "password": password}).status_code == 422
    db.user.create.assert_not_awaited()

def test_registration_is_generic_and_ignores_privileged_fields(client):
    c, db, _ = client
    body = {"email": "new@gmail.com", "name": "New", "password": PASSWORD, "role": "Admin"}
    existing = c.post("/api/auth/register", headers=WRITE, json=body)
    db.user.find_unique.return_value = None
    new = c.post("/api/auth/register", headers=WRITE, json=body)
    assert existing.status_code == new.status_code == 200 and existing.json() == new.json()
    data = db.user.create.await_args.kwargs["data"]
    assert data["role"] == "Clinician"
    assert security.verify_password(PASSWORD, data["passwordHash"])
    assert not c.cookies.get(security.COOKIE_NAME)

def test_breach_lookup_unavailable_does_not_create_account(client, monkeypatch):
    c, db, _ = client
    def unavailable(password):
        raise PasswordCheckUnavailable()
    monkeypatch.setattr(api, "check_new_password", unavailable)
    assert c.post("/api/auth/register", headers=WRITE,
                  json={"email": "new@gmail.com", "name": "New", "password": PASSWORD}).status_code == 503
    db.user.create.assert_not_awaited()

@pytest.mark.parametrize("mutate", [
    lambda c: c.pop("exp"),
    lambda c: c.update(iss="wrong"),
    lambda c: c.update(aud="wrong"),
    lambda c: c.update(exp=int(time.time())-10),
    lambda c: c.update(exp="tomorrow"),
    lambda c: c.update(sub=7),
])
def test_invalid_signed_claims_are_rejected(mutate):
    token = security.create_access_token({"sub": "7", "email": "owner@example.test"})
    claims = jwt.decode(token, options={"verify_signature": False})
    mutate(claims)
    token = jwt.encode(claims, security.JWT_SECRET, algorithm="HS256")
    with pytest.raises(ValueError):
        security.decode_access_token(token)

def test_unsigned_and_tampered_tokens_are_rejected():
    token = security.create_access_token({"sub": "7", "email": "owner@example.test"})
    with pytest.raises(ValueError):
        security.decode_access_token(token[:-5]+"AAAAA")
    token = jwt.encode({"sub": "7"}, key="", algorithm="none")
    with pytest.raises(ValueError):
        security.decode_access_token(token)

def test_hashes_have_unique_salts_and_preserve_unicode_whitespace():
    password = "  \u0e01\u0e02 password phrase  "
    a,b = security.hash_password(password),security.hash_password(password)
    assert a != b
    assert security.verify_password(password,a)
    assert not security.verify_password(password.strip(),a)
    assert not security.verify_password("wrong",a)
    assert not security.verify_password("x"*129,a)

def test_breach_check_sends_only_hash_prefix_and_rejects_a_match(monkeypatch):
    from app.auth import password_policy as policy
    digest = hashlib.sha1(PASSWORD.encode()).hexdigest().upper()
    seen = []
    class Response:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def read(self,size): return (digest[5:]+":12\r\n").encode()
    def lookup(request, timeout):
        seen.append(request.full_url)
        assert request.get_header("Add-padding") == "true"
        return Response()
    monkeypatch.setattr(policy,"urlopen",lookup)
    with pytest.raises(ValueError):
        check_new_password(PASSWORD)
    assert seen == ["https://api.pwnedpasswords.com/range/"+digest[:5]]

def test_validation_error_never_echoes_password(client):
    c, _, _ = client
    password = "do-not-echo-this-password-"*8
    r = c.post("/api/auth/login", headers=WRITE,
               json={"email": "owner@example.test", "password": password})
    assert r.status_code == 422
    assert password not in r.text and "input" not in r.json()

def test_unregistered_signed_token_does_not_create_a_session(client):
    c, _, _ = client
    token = security.create_access_token({"sub": "7", "email": "owner@example.test"})
    claims = jwt.decode(token, options={"verify_signature": False})
    claims["jti"] = "a-different-unregistered-session-"*2
    token = jwt.encode(claims, security.JWT_SECRET, algorithm="HS256")
    assert c.get("/api/auth/me", headers={"Authorization": "Bearer "+token}).status_code == 401

def test_account_attempt_reservations_are_atomic():
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=12) as workers:
        results = list(workers.map(state.reserve_login, ["same@example.test"]*12))
    assert results.count(0) == state.MAX_ATTEMPTS
    assert all(value > 0 for value in results if value != 0)

def test_missing_signing_key_fails_startup():
    import os, subprocess, sys
    env = dict(os.environ, JWT_SECRET="")
    result = subprocess.run([sys.executable, "-c", "import app.auth.security"], env=env,
                            capture_output=True, text=True)
    assert result.returncode != 0 and "JWT_SECRET must be configured" in result.stderr


@pytest.mark.parametrize("email", ["user@yahoo.com", "user@gmail.com.evil.test", "user@sub.gmail.com", "user@@gmail.com", "@gmail.com", "user name@gmail.com", "user@gmailXcom"])
def test_registration_only_allows_exact_gmail_domain(client, monkeypatch, email):
    c, db, _ = client
    checker = Mock()
    monkeypatch.setattr(api, "check_new_password", checker)
    r = c.post("/api/auth/register", headers=WRITE,
               json={"email": email, "name": "New", "password": PASSWORD})
    assert r.status_code == 400
    checker.assert_not_called()
    db.user.find_unique.assert_not_awaited()
    db.user.create.assert_not_awaited()


def test_gmail_registration_normalizes_case_and_preserves_alias(client):
    c, db, _ = client
    db.user.find_unique.return_value = None
    r = c.post("/api/auth/register", headers=WRITE,
               json={"email": " User.Name+tag@GMAIL.COM ", "name": "New", "password": PASSWORD})
    assert r.status_code == 200
    assert db.user.create.await_args.kwargs["data"]["email"] == "user.name+tag@gmail.com"

@pytest.mark.parametrize("suffix", ["\u0e44\u0e17\u0e22", "\U0001f600", "\u00e9", "\u00a0", "\u200b", "\t", "\n"])
def test_new_password_rejects_non_ascii_before_breach_lookup(client, monkeypatch, suffix):
    from app.auth import password_policy as policy
    c, db, _ = client
    lookup = Mock()
    monkeypatch.setattr(policy, "urlopen", lookup)
    monkeypatch.setattr(api, "check_new_password", policy.check_new_password)
    response = c.post("/api/auth/register", headers=WRITE,
                      json={"email": "new@gmail.com", "name": "New",
                            "password": "a long unique phrase"+suffix})
    assert response.status_code == 400
    assert "English letters" in response.json()["detail"]
    lookup.assert_not_called()
    db.user.create.assert_not_awaited()

def test_printable_ascii_password_and_spaces_are_preserved(client, monkeypatch):
    from app.auth import password_policy as policy
    c, db, _ = client
    password = " English passphrase !23 "
    class Response:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def read(self,size): return ("A"*35+":0\r\n").encode()
    monkeypatch.setattr(policy, "urlopen", lambda *args, **kwargs: Response())
    monkeypatch.setattr(api, "check_new_password", policy.check_new_password)
    db.user.find_unique.return_value = None
    response = c.post("/api/auth/register", headers=WRITE,
                      json={"email": "new@gmail.com", "name": "New", "password": password})
    assert response.status_code == 200
    encoded = db.user.create.await_args.kwargs["data"]["passwordHash"]
    assert security.verify_password(password, encoded)
    assert not security.verify_password(password.strip(), encoded)
