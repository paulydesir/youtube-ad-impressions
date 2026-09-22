# YouTube Ad Transcription Worker

Async local Whisper transcription for captured YouTube ads. Runs as a short-lived
batch: boot, claim N pending jobs, transcribe each unique `ad_video_id` once,
persist the full transcript to `ads`, mark `transcription_jobs` completed, exit.

## Layout

```text
workers/transcription/
├── pyproject.toml
├── worker.py
├── README.md
└── tests/
```

## Env

```text
DATABASE_URL            required (never logged)
TRANSCRIPTION_BATCH_SIZE default 20
WHISPER_MODEL            default base.en
WHISPER_LANGUAGE         default en
MAX_MEDIA_BYTES          default 52428800 (50 MB)
STALE_PROCESSING_HOURS   default 2
LOG_TRANSCRIPT           default 0 (set 1 to log transcript prefixes)
```

## Run locally

```bash
/opt/homebrew/bin/python3.13 -m venv .venv-worker
source .venv-worker/bin/activate
pip install -e workers/transcription
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
TRANSCRIPTION_BATCH_SIZE=5 \
python workers/transcription/worker.py
```

Requires `ffmpeg` for `yt-dlp` audio extraction:

```bash
brew install ffmpeg
```

## Tests

```bash
/opt/homebrew/bin/python3.13 -m pytest workers/transcription/tests -v
```

Unit tests mock `yt-dlp`/`faster-whisper` and use SQL-level fakes for
claim/complete/fail paths. DB integration tests are skipped unless
`DATABASE_URL` is set.
