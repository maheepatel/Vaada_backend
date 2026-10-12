-- Fix "permission denied for table media_assets" once and for all, and repair
-- the previous migration that silently failed.
--
-- ROOT CAUSE of "permission denied for table media_assets":
-- RLS policies only decide WHICH ROWS a role may touch. A role must ALSO hold
-- a plain Postgres table-level GRANT before RLS is even evaluated. media_assets
-- was added after the project's initial setup (202608270001) and never
-- received that grant, so every insert/select from the `authenticated` role
-- failed with "permission denied for table media_assets" no matter how
-- correct the RLS policies were (RLS policy fixes in 202608300005 alone could
-- never have solved this).
--
-- SECOND BUG fixed here: 202608300006_public_evidence_visibility.sql ran
-- `alter table public.published_evidence_with_media enable row level security`
-- and `create policy ... on public.published_evidence_with_media`, but that
-- object is a VIEW, not a table — Postgres rejects both statements with
-- "... is not a table". Supabase's SQL editor runs a pasted script as one
-- transaction, so that error rolled back the ENTIRE migration, including the
-- "public view verified proof media" policy on media_assets it created first.
-- This migration re-creates that policy and rebuilds the view correctly.
--
-- Safe to run multiple times.

-- ==============================================================
-- 1. Table-level grants — this is the actual fix for "permission denied"
-- ==============================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update on public.media_assets to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.submissions to authenticated;
grant select, insert, delete on public.watchers to authenticated;

grant select on public.commitments to anon, authenticated;
grant select on public.evidence to anon, authenticated;
grant select on public.timeline_events to anon, authenticated;

-- ==============================================================
-- 2. Re-apply media_assets RLS policies (idempotent)
-- ==============================================================
drop policy if exists "permanent users insert media" on public.media_assets;
drop policy if exists "permanent users update own media" on public.media_assets;
drop policy if exists "permanent users read own media metadata" on public.media_assets;
drop policy if exists "public view verified proof media" on public.media_assets;

create policy "permanent users insert media" on public.media_assets
for insert to authenticated
with check (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

create policy "permanent users update own media" on public.media_assets
for update to authenticated
using (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false)
with check (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

create policy "permanent users read own media metadata" on public.media_assets
for select to authenticated
using (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

-- Anyone (including logged-out visitors) can see media that is attached to a
-- verified/contested proof on a published promise. This is what makes an
-- uploaded proof image visible to everyone once a reviewer verifies it.
create policy "public view verified proof media" on public.media_assets
for select
using (
  exists (
    select 1 from public.evidence e
    join public.commitments c on c.id = e.commitment_id
    where e.media_asset_id = media_assets.id
      and e.verdict in ('verified', 'contested')
      and c.published_at is not null
  )
);

-- ==============================================================
-- 3. Rebuild published_evidence_with_media as a valid view
-- ==============================================================
create or replace view public.published_evidence_with_media
with (security_invoker = true) as
select
  e.id, e.commitment_id, e.kind, e.title, e.source_kind, e.source_url,
  e.media_asset_id, e.storage_path, e.media_type, e.verdict, e.document_date, e.reviewed_at,
  m.original_filename, m.size_bytes, m.sha256,
  c.slug as commitment_slug, c.title as commitment_title, c.status as commitment_status
from public.evidence e
join public.commitments c on c.id = e.commitment_id
left join public.media_assets m on m.id = e.media_asset_id
where e.verdict in ('verified', 'contested')
  and c.published_at is not null;

grant select on public.published_evidence_with_media to anon, authenticated;
