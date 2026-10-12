-- Add public visibility for verified proofs and link media to commitments
-- This allows anyone to see uploaded proof images after they're marked as verified

-- ==============================================================
-- ADD PUBLIC ACCESS TO VERIFIED MEDIA
-- ==============================================================

-- Add policy to allow public viewing of media attached to verified evidence
create policy "public view verified proof media" on public.media_assets
for select
using (
  -- Can view if media is attached to verified evidence of a published promise
  exists (
    select 1 from public.evidence e
    join public.commitments c on c.id = e.commitment_id
    where e.media_asset_id = media_assets.id
      and e.verdict in ('verified', 'contested')
      and c.published_at is not null
  )
);

-- ==============================================================
-- ADD LINK FROM EVIDENCE TO COMMITMENTS IN RESPONSE
-- ==============================================================
-- This is already done via the commitment_id foreign key in evidence table
-- The public view already includes evidence linked to published commitments

-- ==============================================================
-- CREATE PUBLIC VIEW FOR EVIDENCE WITH MEDIA DETAILS
-- ==============================================================

-- This view makes it easy to fetch verified proofs with all details
create or replace view public.published_evidence_with_media as
select 
  e.id,
  e.commitment_id,
  e.kind,
  e.title,
  e.source_kind,
  e.source_url,
  e.media_asset_id,
  e.storage_path,
  e.media_type,
  e.verdict,
  e.document_date,
  e.reviewed_at,
  m.original_filename,
  m.size_bytes,
  m.sha256,
  c.slug as commitment_slug,
  c.title as commitment_title,
  c.status as commitment_status
from public.evidence e
join public.commitments c on c.id = e.commitment_id
left join public.media_assets m on m.id = e.media_asset_id
where e.verdict in ('verified', 'contested')
  and c.published_at is not null;

-- Grant public access to the view
grant select on public.published_evidence_with_media to anon, authenticated;

-- ==============================================================
-- ADD POLICY TO VIEW (no RLS needed, view already filters)
-- ==============================================================

alter table public.published_evidence_with_media enable row level security;

create policy "public select on published evidence view" on public.published_evidence_with_media
for select using (true);
