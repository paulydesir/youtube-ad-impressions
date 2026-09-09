-- Register each dedicated MCP OAuth client here after creating it in Supabase
-- Auth. Only the Auth hook and database administrators can read this mapping.
create schema if not exists private;
create table private.mcp_oauth_clients (
  client_id text primary key check (length(client_id) > 0),
  resource_url text not null check (resource_url ~ '^https?://')
);
revoke all on private.mcp_oauth_clients from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on private.mcp_oauth_clients to supabase_auth_admin;

create function public.mcp_oauth_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  resource_url text;
  claims jsonb := event->'claims';
begin
  -- client_id is set by Auth, never by user_metadata. This also applies when
  -- refreshing the OAuth session. Ordinary extension sessions are unchanged.
  select c.resource_url into resource_url
    from private.mcp_oauth_clients c
    where c.client_id = claims->>'client_id';
  if resource_url is not null then
    claims := jsonb_set(claims, '{aud}', to_jsonb(resource_url));
  end if;
  return jsonb_build_object('claims', claims);
end;
$$;
revoke execute on function public.mcp_oauth_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.mcp_oauth_access_token_hook(jsonb) to supabase_auth_admin;
