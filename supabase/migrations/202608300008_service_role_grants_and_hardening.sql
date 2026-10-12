-- Restore the grants the backend itself needs, and close two holes opened by
-- migrations 202608300005 / 202608300007. Safe to run multiple times.
--
-- WHY THE UPLOAD -> REVIEW -> RENDER PIPELINE KEPT FAILING
-- Postgres checks table-level GRANTs before RLS. On this project the backend's
-- `service_role` holds NO grants on the public tables (verified live: every
-- service-role read of evidence / media_assets / profiles / submissions returns
-- "permission denied for table ..."). Migration 007 granted only anon and
-- authenticated. The backend uses service_role for:
--   * reviewerFrom()                 -> reads profiles.role  (nobody was ever a reviewer)
--   * POST /v1/submissions           -> reads media_assets   ("That upload is unavailable")
--   * GET  /v1/review/submissions    -> reads submissions
--   * GET  /v1/evidence/:id/file     -> reads evidence       (proof images 404 on the site)
--   * pending completion proof count -> reads submissions
-- Every one of those failed silently (the error was swallowed and treated as
-- "not found"), so the symptoms looked like several unrelated bugs.

-- ==============================================================
-- 1. service_role: full access (it already bypasses RLS)
-- ==============================================================
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Future tables/functions created by the migration role inherit the same grants.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- ==============================================================
-- 2. SECURITY: users must not be able to rewrite their own profile row
-- ==============================================================
-- Migrations 005 + 007 let any signed-in user UPDATE/INSERT public.profiles
-- directly. With no column restriction that includes `role`, so anyone could
-- run  PATCH /rest/v1/profiles?id=eq.<me> {"role":"admin"}  and become a
-- reviewer/admin. Profile edits go through the SECURITY DEFINER function
-- public.update_my_profile(), and rows are created by the on_auth_user_created
-- trigger, so no direct write access is needed.
revoke insert, update on public.profiles from authenticated;
drop policy if exists "permanent users update own profile" on public.profiles;
drop policy if exists "permanent users insert own profile" on public.profiles;

-- ==============================================================
-- 3. SECURITY: users must not be able to rewrite their own upload records
-- ==============================================================
-- The upload endpoint only needs INSERT (+ SELECT). Letting the owner UPDATE a
-- media_assets row would allow changing storage_path / sha256 / status after
-- the fact (e.g. pointing an asset at another user's file). Status changes are
-- made by the SECURITY DEFINER trigger attach_submission_media() and
-- review_submission(), which do not need this grant.
revoke update on public.media_assets from authenticated;
drop policy if exists "permanent users update own media" on public.media_assets;

-- ==============================================================
-- 4. Make sure the grants the rest of the app relies on are present
-- ==============================================================
grant usage on schema public to anon, authenticated;
grant select on public.commitments, public.evidence, public.timeline_events to anon, authenticated;
grant select on public.commitments_public to anon, authenticated;
grant select, insert on public.media_assets to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.submissions to authenticated;
grant select, insert, delete on public.watchers to authenticated;
