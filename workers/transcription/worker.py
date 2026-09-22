"""YouTube Ad Transcription Worker — vertical slice.

Batch flow:
  boot -> connect Postgres -> recover stale processing jobs ->
  claim up to N pending jobs -> load Whisper model once ->
  for each job: yt-dlp download (in memory) -> faster-whisper transcribe,
  falling back to YouTube captions on acquisition/transcription failure ->
  persist transcript + mark completed (same transaction) ->
  on per-job failure: mark failed, continue -> exit.

Transcription unit is the unique YouTube ad_video_id (ads.source='youtube',
ads.source_ad_id). Impressions are never duplicated with transcripts.
"""

from __future__ import annotations

import io
import logging
import os
import subprocess
import sys
from dataclasses import dataclass

import psycopg
from requests import Session
from youtube_transcript_api import YouTubeTranscriptApi

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("transcription-worker")

WHISPER_MODEL_NAME = os.environ.get("WHISPER_MODEL", "base.en")
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "en")
BATCH_SIZE = int(os.environ.get("TRANSCRIPTION_BATCH_SIZE", "20"))
MAX_MEDIA_BYTES = int(os.environ.get("MAX_MEDIA_BYTES", str(50 * 1024 * 1024)))
STALE_PROCESSING_HOURS = float(os.environ.get("STALE_PROCESSING_HOURS", "2"))
LOG_TRANSCRIPT = os.environ.get("LOG_TRANSCRIPT", "0") == "1"


@dataclass
class Job:
    job_id: str
    ad_id: str
    source_ad_id: str


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL must be set to run the transcription worker.")
    return url


def sanitize_error(message: str, limit: int = 2000) -> str:
    secret = os.environ.get("DATABASE_URL", "")
    if secret and secret in message:
        message = message.replace(secret, "[redacted]")
    return message.strip()[:limit] or "unknown error"


def recover_stale_jobs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE transcription_jobs
            SET status = 'pending',
                started_at = NULL,
                updated_at = now()
            WHERE status = 'processing'
              AND started_at < now() - (%s * interval '1 hour')
            """,
            (STALE_PROCESSING_HOURS,),
        )
        count = cur.rowcount or 0
    conn.commit()
    return count


def claim_jobs(conn: psycopg.Connection, batch_size: int) -> list[Job]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT tj.id, tj.ad_id, a.source_ad_id
            FROM transcription_jobs tj
            JOIN ads a ON a.id = tj.ad_id
            WHERE tj.status = 'pending'
            ORDER BY tj.created_at
            FOR UPDATE OF tj SKIP LOCKED
            LIMIT %s
            """,
            (batch_size,),
        )
        rows = cur.fetchall()
        if not rows:
            conn.commit()
            return []
        job_ids = [r[0] for r in rows]
        cur.execute(
            """
            UPDATE transcription_jobs
            SET status = 'processing',
                attempt_count = attempt_count + 1,
                started_at = now(),
                updated_at = now()
            WHERE id = ANY(%s)
            """,
            (job_ids,),
        )
    conn.commit()
    return [Job(job_id=str(r[0]), ad_id=str(r[1]), source_ad_id=str(r[2])) for r in rows]


def youtube_url(ad_video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={ad_video_id}"


def download_audio(ad_video_id: str, max_bytes: int = MAX_MEDIA_BYTES) -> bytes:
    url = youtube_url(ad_video_id)
    log.info(f"[{ad_video_id}] download started")
    try:
        result = subprocess.run(
            ["yt-dlp", "--no-playlist", "-f", "ba", "-o", "-", url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=300,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode("utf-8", "replace").strip()[-500:]
        raise RuntimeError(f"yt-dlp failed: {stderr or exc}") from exc
    media = result.stdout or b""
    if not media:
        raise RuntimeError("yt-dlp returned empty media")
    if len(media) > max_bytes:
        raise RuntimeError(f"media {len(media)} bytes exceeds {max_bytes} byte limit")
    log.info(f"[{ad_video_id}] download complete: {len(media)} bytes")
    return media


def load_model(model_name: str = WHISPER_MODEL_NAME):
    from faster_whisper import WhisperModel

    log.info(f"loading Whisper model once: {model_name} (cpu, int8)")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    log.info("model loaded")
    return model


def transcribe_audio(model, audio_bytes: bytes, language: str = WHISPER_LANGUAGE) -> tuple[str, str]:
    stream = io.BytesIO(audio_bytes)
    segments, info = model.transcribe(stream, language=language, vad_filter=True)
    parts: list[str] = []
    for segment in segments:
        text = (segment.text or "").strip()
        if text:
            parts.append(text)
    transcript = " ".join(parts).strip()
    detected = getattr(info, "language", None) or language
    return transcript, detected


class CaptionSession(Session):
    """Bound each caption HTTP request so a blocked request cannot hang the batch."""

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", (10, 30))
        return super().request(method, url, **kwargs)


def download_transcript(ad_video_id: str, language: str = WHISPER_LANGUAGE) -> tuple[str, str, str]:
    log.info(f"[{ad_video_id}] caption download started")
    with CaptionSession() as session:
        result = YouTubeTranscriptApi(http_client=session).fetch(
            ad_video_id, languages=[language]
        )
    transcript = " ".join(segment.text.strip() for segment in result if segment.text.strip())
    if not transcript:
        raise RuntimeError("YouTube returned empty captions")
    source = "youtube-captions:auto" if result.is_generated else "youtube-captions:manual"
    return transcript, result.language_code, source


def complete_job(
    conn: psycopg.Connection,
    job: Job,
    transcript: str,
    language: str,
    model_name: str,
) -> None:
    if not transcript.strip():
        raise RuntimeError("empty transcript")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ads
            SET transcript = %s,
                transcript_language = %s,
                transcription_model = %s,
                transcribed_at = now(),
                updated_at = now()
            WHERE id = %s
            """,
            (transcript, language, model_name, job.ad_id),
        )
        cur.execute(
            """
            UPDATE transcription_jobs
            SET status = 'completed',
                completed_at = now(),
                last_error = NULL,
                updated_at = now()
            WHERE id = %s
            """,
            (job.job_id,),
        )
    conn.commit()


def fail_job(conn: psycopg.Connection, job: Job, error: Exception) -> None:
    message = sanitize_error(f"{type(error).__name__}: {error}")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE transcription_jobs
            SET status = 'failed',
                last_error = %s,
                updated_at = now()
            WHERE id = %s
            """,
            (message, job.job_id),
        )
    conn.commit()


def process_job(conn: psycopg.Connection, model, job: Job, model_name: str) -> bool:
    try:
        try:
            media = download_audio(job.source_ad_id)
            log.info(f"[{job.source_ad_id}] transcription started")
            transcript, language = transcribe_audio(model, media)
            if not transcript.strip():
                raise RuntimeError("empty Whisper transcript")
        except Exception as primary_exc:
            log.warning(
                f"[{job.source_ad_id}] audio transcription failed; trying captions: "
                f"{sanitize_error(str(primary_exc))[:300]}"
            )
            try:
                transcript, language, model_name = download_transcript(job.source_ad_id)
            except Exception as fallback_exc:
                raise RuntimeError(
                    f"audio transcription failed ({type(primary_exc).__name__}): "
                    f"{sanitize_error(str(primary_exc), 700)}; "
                    f"caption fallback failed ({type(fallback_exc).__name__}): "
                    f"{sanitize_error(str(fallback_exc), 700)}"
                ) from fallback_exc
        complete_job(conn, job, transcript, language, model_name)
        log.info(f"[{job.source_ad_id}] transcription complete: {len(transcript)} chars")
        log.info(f"[{job.source_ad_id}] completed")
        if LOG_TRANSCRIPT:
            log.info(f"[{job.source_ad_id}] transcript: {transcript[:500]}")
        return True
    except Exception as exc:  # per-job failure must not stop the batch
        try:
            fail_job(conn, job, exc)
        except Exception as db_exc:
            log.warning(f"[{job.source_ad_id}] failed to record failure: {db_exc}")
            try:
                conn.rollback()
            except Exception:
                pass
        log.warning(f"[{job.source_ad_id}] failed: {sanitize_error(str(exc))[:300]}")
        return False


def main() -> int:
    log.info("worker started")
    database_url = get_database_url()
    _ = database_url  # never log the URL
    batch_size = BATCH_SIZE
    model_name = WHISPER_MODEL_NAME
    success = 0
    failed = 0
    try:
        conn = psycopg.connect(database_url)
    except Exception as exc:
        log.warning(f"failed to connect to Postgres: {sanitize_error(str(exc))[:300]}")
        return 1
    with conn:
        try:
            recovered = recover_stale_jobs(conn)
            if recovered:
                log.info(f"recovered stale processing jobs: {recovered}")
            jobs = claim_jobs(conn, batch_size)
        except Exception as exc:
            log.warning(f"failed to claim jobs: {sanitize_error(str(exc))[:300]}")
            return 1
        log.info(f"pending jobs claimed: {len(jobs)}")
        if not jobs:
            log.info("batch completed success=0 failed=0")
            return 0
        try:
            model = load_model(model_name)
        except Exception as exc:
            log.warning(f"failed to load Whisper model: {sanitize_error(str(exc))[:300]}")
            return 1
        for job in jobs:
            if process_job(conn, model, job, model_name):
                success += 1
            else:
                failed += 1
    log.info(f"batch completed success={success} failed={failed}")
    return 0 if failed == 0 else 0  # batch exit 0 even with per-job failures


if __name__ == "__main__":
    sys.exit(main())
