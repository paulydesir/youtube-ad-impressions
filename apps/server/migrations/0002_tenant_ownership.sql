-- Preserve legacy local rows without assigning them to an arbitrary account.
ALTER TABLE ad_impressions ADD COLUMN user_id text;
--> statement-breakpoint
DROP INDEX ad_impressions_event_id_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX ad_impressions_user_id_event_id_unique ON ad_impressions(user_id, event_id);
