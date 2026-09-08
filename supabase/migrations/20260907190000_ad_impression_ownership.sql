-- Existing ad impressions are disposable local-development/test data. Clear
-- them before introducing required ownership so no row is assigned arbitrarily.
delete from public.ad_impressions;

alter table public.ad_impressions
  add column user_id uuid not null
  references public.profiles(id) on delete cascade;

drop index public.ad_impressions_event_id_unique;

create unique index ad_impressions_user_id_event_id_unique
  on public.ad_impressions (user_id, event_id);
