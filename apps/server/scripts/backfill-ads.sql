-- Backfill ads + transcription_jobs from pre-existing impressions.
--
-- One-time data migration. Run it once directly against the database
-- (Supabase Studio SQL editor, or: psql "$DATABASE_URL" -f backfill-ads.sql)
-- after the 0002 migration has created the ads / transcription_jobs tables.
--
-- Safe to re-run: every statement is idempotent (ON CONFLICT DO NOTHING,
-- and the UPDATE only touches rows where ad_id IS NULL).

-- 1. One ads row per unique YouTube ad video ID already observed.
INSERT INTO ads (id, source, source_ad_id)
SELECT gen_random_uuid(), 'youtube', ad_video_id
FROM (
  SELECT DISTINCT ad_video_id
  FROM ad_impressions
  WHERE ad_video_id IS NOT NULL AND btrim(ad_video_id) <> ''
) existing
ON CONFLICT (source, source_ad_id) DO NOTHING;

-- 2. Link impressions (including old ones) to their canonical ad row.
UPDATE ad_impressions i
SET ad_id = a.id
FROM ads a
WHERE a.source = 'youtube'
  AND a.source_ad_id = i.ad_video_id
  AND i.ad_video_id IS NOT NULL
  AND i.ad_id IS NULL;

-- 3. One pending job per ad that has no transcript yet.
INSERT INTO transcription_jobs (id, ad_id, status)
SELECT gen_random_uuid(), a.id, 'pending'
FROM ads a
WHERE a.transcript IS NULL
ON CONFLICT (ad_id) DO NOTHING;

-- Summary counts for the editor output.
SELECT count(*) AS ads FROM ads;
SELECT status, count(*) FROM transcription_jobs GROUP BY status;
SELECT count(*) AS impressions_linked FROM ad_impressions WHERE ad_id IS NOT NULL;
