UPDATE `ad_impressions`
SET `pod_id` = 'legacy-pod:' || `event_id`
WHERE `event_id` LIKE 'legacy-%';
