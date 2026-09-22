# YouTube Ad Transcription Worker

Async local Whisper transcription for captured YouTube ads. Runs as a short-lived
batch: boot, claim N pending jobs, transcribe each unique `ad_video_id` once,
persist the full transcript to `ads`, mark `transcription_jobs` completed, exit.

Each job first downloads audio with `yt-dlp` and transcribes it with Whisper.
If downloading or transcription fails (including an empty transcript), the worker
tries `youtube-transcript-api` for existing captions in `WHISPER_LANGUAGE`.
Caption results use `youtube-captions:auto` or `youtube-captions:manual` in
`transcription_model`; Whisper results keep the configured model name.
If both paths fail, the job is marked failed with both errors. Cloud IP blocking
can affect both paths. Caption requests have 10-second connect and 30-second read
timeouts. Model loading remains a batch prerequisite.

The GitHub Actions workflow installs this dependency from `pyproject.toml`;
no additional credentials are needed. Only pending jobs are claimed, so previously
failed jobs are not automatically retried by this change.

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

Unit tests mock audio and caption retrieval and use SQL-level fakes for
claim/complete/fail paths. They do not contact YouTube or the database.
