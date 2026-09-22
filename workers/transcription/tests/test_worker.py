import io
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
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
        patch.object(worker, "download_transcript") as captions,
    ):
        assert worker.process_job(conn, model, job, "base.en") is True
    captions.assert_not_called()
    assert conn.cursor_obj.executed[0][1] == ("hi there", "en", "base.en", "a1")


def test_process_job_failure_records_failed():
    conn = FakeConn()
    job = worker.Job(job_id="j1", ad_id="a1", source_ad_id="vid1")
    model = MagicMock()
    with (
        patch.object(worker, "download_audio", side_effect=RuntimeError("Video unavailable")),
        patch.object(worker, "download_transcript", side_effect=RuntimeError("Captions blocked")),
    ):
        assert worker.process_job(conn, model, job, "base.en") is False
    assert conn.commits >= 1
    error = conn.cursor_obj.executed[0][1][0]
    assert "Video unavailable" in error
    assert "Captions blocked" in error


@pytest.mark.parametrize("failure", ["download", "transcribe", "empty"])
def test_caption_fallback_completes_job(failure):
    conn = FakeConn()
    job = worker.Job(job_id="j1", ad_id="a1", source_ad_id="vid1")
    with (
        patch.object(worker, "download_audio", return_value=b"audio") as download,
        patch.object(worker, "transcribe_audio", return_value=(" ", "en")) as transcribe,
        patch.object(worker, "download_transcript", return_value=("caption text", "en", "youtube-captions:auto")) as captions,
    ):
        if failure == "download":
            download.side_effect = RuntimeError("bot detected")
        elif failure == "transcribe":
            transcribe.side_effect = RuntimeError("decoding failed")
        assert worker.process_job(conn, MagicMock(), job, "base.en") is True
    captions.assert_called_once_with("vid1")
    assert conn.cursor_obj.executed[0][1] == ("caption text", "en", "youtube-captions:auto", "a1")
    assert conn.commits == 1


def test_persistence_failure_does_not_trigger_caption_fallback():
    with (
        patch.object(worker, "download_audio", return_value=b"audio"),
        patch.object(worker, "transcribe_audio", return_value=("hello", "en")),
        patch.object(worker, "complete_job", side_effect=RuntimeError("database unavailable")),
        patch.object(worker, "download_transcript") as captions,
    ):
        assert worker.process_job(FakeConn(), MagicMock(), worker.Job("j1", "a1", "vid1"), "base.en") is False
    captions.assert_not_called()


@pytest.mark.parametrize("generated", [True, False])
def test_download_transcript_preserves_language_and_source(generated):
    from youtube_transcript_api import FetchedTranscript, FetchedTranscriptSnippet

    result = FetchedTranscript(
        snippets=[FetchedTranscriptSnippet(text=text, start=i, duration=1) for i, text in enumerate([" hello ", " ", "world"])],
        video_id="vid1", language="French", language_code="fr", is_generated=generated,
    )
    with patch.object(worker, "YouTubeTranscriptApi") as api:
        api.return_value.fetch.return_value = result
        transcript, language, source = worker.download_transcript("vid1", language="fr")
    api.return_value.fetch.assert_called_once_with("vid1", languages=["fr"])
    assert (transcript, language) == ("hello world", "fr")
    assert source == ("youtube-captions:auto" if generated else "youtube-captions:manual")


def test_download_transcript_rejects_empty_captions():
    with patch.object(worker, "YouTubeTranscriptApi") as api:
        api.return_value.fetch.return_value = [SimpleNamespace(text="  ")]
        with pytest.raises(RuntimeError, match="empty captions"):
            worker.download_transcript("vid1")


def test_caption_requests_have_timeout():
    with patch.object(worker.Session, "request") as request:
        with worker.CaptionSession() as session:
            session.get("https://www.youtube.com")
    assert request.call_args.kwargs["timeout"] == (10, 30)
