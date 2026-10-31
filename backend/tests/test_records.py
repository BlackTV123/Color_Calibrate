from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient

from app import main as api
from app.auth import create_access_token


@pytest.fixture
def records_client(monkeypatch):
    user = SimpleNamespace(id=7, email="owner@example.test")
    record = SimpleNamespace(
        id=12, userId=7, patientId="CASE-1", woundLocation="Arm", imageFilename="photo.jpg",
        estimatedAge="", confidence=0.0, deltaE00=0.0, surfaceAreaMm2=120.0,
        dominantHex="#123456", summary="", thumbnail=None,
        resultJson='{"calibration": {"is_calibrated": false}}',
        createdAt=datetime(2026, 10, 31, tzinfo=timezone.utc),
    )
    database = SimpleNamespace(
        is_connected=Mock(return_value=True),
        user=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        record=SimpleNamespace(
            find_many=AsyncMock(return_value=[record]), count=AsyncMock(return_value=1),
            find_first=AsyncMock(return_value=record), create=AsyncMock(return_value=record),
            delete_many=AsyncMock(return_value=1),
        ),
    )
    monkeypatch.setattr(api, "db", database)
    client = TestClient(api.app)
    token = create_access_token({"sub": "7", "email": user.email})
    return client, database, {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/auth/me", None),
    ("get", "/api/records", None),
    ("get", "/api/records/12", None),
    ("delete", "/api/records/12", None),
    ("post", "/api/records", {"resultJson": {}}),
])
@pytest.mark.parametrize("authorization", [None, "Bearer invalid"])
def test_records_require_valid_login(records_client, method, path, body, authorization):
    client, database, _ = records_client
    headers = {"Authorization": authorization} if authorization else {}
    options = {"json": body} if body is not None else {}
    response = client.request(method, path, headers=headers, **options)
    assert response.status_code == 401
    database.user.find_unique.assert_not_awaited()
    database.record.delete_many.assert_not_awaited()


def test_list_ignores_spoofed_email_and_scopes_search_and_pagination(records_client):
    client, database, headers = records_client
    response = client.get("/api/records?userEmail=victim@example.test&search=arm&limit=10&offset=20", headers=headers)
    assert response.status_code == 200
    database.user.find_unique.assert_awaited_once_with(where={"id": 7})
    query = database.record.find_many.await_args.kwargs
    assert query["where"]["AND"][0] == {"userId": 7}
    assert query["take"] == 10 and query["skip"] == 20
    assert database.record.count.await_args.kwargs["where"] == query["where"]


def test_read_scopes_record_to_owner(records_client):
    client, database, headers = records_client
    assert client.get("/api/records/12", headers=headers).status_code == 200
    database.record.find_first.assert_awaited_once_with(where={"id": 12, "userId": 7})


def test_other_accounts_record_is_not_readable_or_deletable(records_client):
    client, database, headers = records_client
    database.record.find_first.return_value = None
    database.record.delete_many.return_value = 0
    assert client.get("/api/records/99", headers=headers).status_code == 404
    assert client.delete("/api/records/99", headers=headers).status_code == 404
    database.record.find_first.assert_awaited_once_with(where={"id": 99, "userId": 7})
    database.record.delete_many.assert_awaited_once_with(where={"id": 99, "userId": 7})


def test_create_never_assigns_request_email_or_unrelated_account(records_client):
    client, database, headers = records_client
    database.record.find_first.return_value = None
    response = client.post("/api/records", headers=headers, json={
        "userEmail": "victim@example.test", "clientRecordId": "retry-1",
        "resultJson": {"calibration": {"is_calibrated": False}},
    })
    assert response.status_code == 201
    created = database.record.create.await_args.kwargs["data"]
    assert created["userId"] == 7
    assert '"_client_record_id": "retry-1"' in created["resultJson"]


def test_retry_reuses_existing_record_in_same_account(records_client):
    client, database, headers = records_client
    response = client.post("/api/records", headers=headers, json={"clientRecordId": "retry-1", "resultJson": {}})
    assert response.status_code == 201 and response.json()["id"] == "12"
    database.record.create.assert_not_awaited()
    query = database.record.find_first.await_args.kwargs["where"]
    assert query["userId"] == 7
    assert query["resultJson"]["contains"] == '"_client_record_id": "retry-1"'


def test_account_removed_does_not_fall_back_to_another_user(records_client):
    client, database, headers = records_client
    database.user.find_unique.return_value = None
    assert client.post("/api/records", headers=headers, json={"resultJson": {}}).status_code == 401
    database.record.create.assert_not_awaited()


def test_delete_failure_is_not_reported_as_success(records_client):
    client, database, headers = records_client
    database.record.delete_many.side_effect = RuntimeError("database unavailable")
    assert client.delete("/api/records/12", headers=headers).status_code == 500

def test_session_restoration_checks_current_account(records_client):
    client, database, headers = records_client
    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "owner@example.test"
    database.user.find_unique.assert_awaited_once_with(where={"id": 7})


def test_deleted_account_cannot_restore_a_session(records_client):
    client, database, headers = records_client
    database.user.find_unique.return_value = None
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_expired_token_cannot_restore_a_session(records_client):
    client, database, _ = records_client
    token = create_access_token({"sub": "7", "email": "owner@example.test"}, expires_in=-1)
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    database.user.find_unique.assert_not_awaited()
