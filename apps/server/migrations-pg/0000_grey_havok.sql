CREATE TABLE "ad_impressions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ad_impressions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"source" text NOT NULL,
	"started_at" text NOT NULL,
	"ended_at" text,
	"duration_ms" integer,
	"host_video_id" text,
	"advertiser_name" text,
	"advertiser_domain" text,
	"ad_headline" text,
	"call_to_action" text,
	"creative_title" text,
	"creative_duration_ms" integer,
	"pod_id" text,
	"pod_label" text,
	"pod_position" integer,
	"pod_size" integer,
	"pod_impression_index" integer,
	"skipped" boolean NOT NULL,
	"skip_clicked_at" text,
	"end_reason" text,
	"raw_json" text NOT NULL,
	"ingested_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_impressions_event_id_unique" ON "ad_impressions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ad_impressions_started_at_idx" ON "ad_impressions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ad_impressions_advertiser_domain_idx" ON "ad_impressions" USING btree ("advertiser_domain");--> statement-breakpoint
CREATE INDEX "ad_impressions_host_video_id_idx" ON "ad_impressions" USING btree ("host_video_id");