import io
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import worker


class FakeCursor:
    def __init__(self, fetch_rows=None):
        self.fetch_rows = fetch_rows or []
        self.executed = []
        self.rowcount = 1

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params=None):
        self.executed.append((str(query), params))

    def fetchall(self):
        return self.fetch_rows


class FakeConn:
    def __init__(self, fetch_rows=None):
        self.cursor_obj = FakeCursor(fetch_rows)
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_youtube_url():
    assert worker.youtube_url("cRBtoZivRs4") == "https://www.youtube.com/watch?v=cRBtoZivRs4"


def test_sanitize_error_redacts_and_truncates(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://secret:pw@host/db")
    msg = worker.sanitize_error("boom postgresql://secret:pw@host/db happened", limit=20)
    assert "secret" not in msg
    assert "[redacted]" in msg
    assert len(msg) <= 20


def test_download_audio_success():
    fake = subprocess.CompletedProcess(args=[], returncode=0, stdout=b"abc123", stderr=b"")
    with patch.object(worker.subprocess, "run", return_value=fake):
        assert worker.download_audio("vid1", max_bytes=100) == b"abc123"


def test_download_audio_empty():
    fake = subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b"")
    with patch.object(worker.subprocess, "run", return_value=fake):
        with pytest.raises(RuntimeError, match="empty media"):
            worker.download_audio("vid1")


def test_download_audio_oversize():
    fake = subprocess.CompletedProcess(args=[], returncode=0, stdout=b"x" * 10, stderr=b"")
    with patch.object(worker.subprocess, "run", return_value=fake):
        with pytest.raises(RuntimeError, match="exceeds"):
            worker.download_audio("vid1", max_bytes=5)


def test_download_audio_ytdlp_failure():
    err = subprocess.CalledProcessError(1, ["yt-dlp"], output=b"", stderr=b"Video unavailable")
    with patch.object(worker.subprocess, "run", side_effect=err):
        with pytest.raises(RuntimeError, match="yt-dlp failed"):
            worker.download_audio("badvideo")


def test_transcribe_audio_joins_segments():
    class Seg:
        def __init__(self, text):
            self.text = text

    class Info:
        language = "en"

    model = MagicMock()
    model.transcribe.return_value = ([Seg(" hello "), Seg(""), Seg("world ")], Info())
    transcript, lang = worker.transcribe_audio(model, b"bytes")
    assert transcript == "hello world"
    assert lang == "en"
    args, kwargs = model.transcribe.call_args
    assert isinstance(args[0], io.BytesIO)
    assert kwargs["language"] == "en"


def test_claim_jobs_empty():
    conn = FakeConn(fetch_rows=[])
    assert worker.claim_jobs(conn, 20) == []
    assert conn.commits == 1


def test_claim_jobs_marks_processing():
    conn = FakeConn(fetch_rows=[("j1", "a1", "vid1"), ("j2", "a2", "vid2")])
    jobs = worker.claim_jobs(conn, 20)
    assert [j.source_ad_id for j in jobs] == ["vid1", "vid2"]
    assert conn.commits == 1
    updates = [q for q, _ in conn.cursor_obj.executed if "processing" in q]
    assert len(updates) == 1


def test_complete_job_updates_both_tables():
    conn = FakeConn()
    job = worker.Job(job_id="j1", ad_id="a1", source_ad_id="vid1")
    worker.complete_job(conn, job, "hello world", "en", "base.en")
    assert conn.commits == 1
    queries = [q for q, _ in conn.cursor_obj.executed]
    assert any("UPDATE ads" in q for q in queries)
    assert any("completed" in q for q in queries)


def test_complete_job_rejects_empty():
    conn = FakeConn()
    job = worker.Job(job_id="j1", ad_id="a1", source_ad_id="vid1")
    with pytest.raises(RuntimeError, match="empty transcript"):
        worker.complete_job(conn, job, "   ", "en", "base.en")


def test_fail_job_marks_failed():
    conn = FakeConn()
    job = worker.Job(job_id="j1", ad_id="a1", source_ad_id="vid1")
    worker.fail_job(conn, job, RuntimeError("yt-dlp failed"))
    assert conn.commits == 1
    assert any("failed" in q for q, _ in conn.cursor_obj.executed)


def test_process_job_success():
    conn = FakeConn()
    job = worker.Job(job_id="j1", ad_id="a1", source_ad_id="vid1")
    model = MagicMock()
    with (
        patch.object(worker, "download_audio", return_value=b"audio"),
        patch.object(worker, "transcribe_audio", return_value=("hi there", "en")),
    ):
        assert worker.process_job(conn, model, job, "base.en") is True


def test_process_job_failure_records_failed():
    conn = FakeConn()
    job = worker.Job(job_id="j1", ad_id="a1", source_ad_id="vid1")
    model = MagicMock()
    with patch.object(worker, "download_audio", side_effect=RuntimeError("Video unavailable")):
        assert worker.process_job(conn, model, job, "base.en") is False
    assert conn.commits >= 1
