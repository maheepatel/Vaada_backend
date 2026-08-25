-- Vaada production baseline for Supabase Postgres/Auth/Storage.
-- Run in a new Supabase project's SQL editor, then enable Anonymous Sign-Ins.
create extension if not exists pgcrypto;

create type public.app_role as enum ('citizen','reviewer','admin');
create type public.commitment_status as enum ('unanswered','promised','in_progress','fulfilled','broken','disputed');
create type public.review_status as enum ('queued','accepted','rejected','needs_info');
create type public.evidence_verdict as enum ('pending','verified','rejected','contested');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'citizen',
  display_name text,
  created_at timestamptz not null default now()
);

create table public.commitments (
  id uuid primary key default gen_random_uuid(), slug text not null unique,
  title text not null check (char_length(title) between 8 and 180), detail text not null,
  state text not null, state_slug text not null, district text not null, district_slug text not null,
  locality text, category text not null, status public.commitment_status not null default 'promised',
  promised_on date not null, deadline_start date, deadline date, deadline_label text,
  constraint valid_deadline_window check (deadline_start is null or deadline is null or deadline_start <= deadline),
  progress smallint not null default 0 check (progress between 0 and 100), beneficiaries text,
  accountable_office text not null, accountable_person text,
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(), commitment_id uuid not null references public.commitments(id) on delete cascade,
  kind text not null check (kind in ('receipt','proof')), title text not null,
  source_kind text not null check (source_kind in ('signed_document','media','press_link','document_link','link_only')),
  source_url text not null, storage_path text, quote text,
  media_type text,
  direction text check (direction in ('supports','refutes')), verdict public.evidence_verdict not null default 'pending',
  document_date date not null, reviewed_at timestamptz, reviewed_by uuid references auth.users(id), created_at timestamptz not null default now(),
  constraint evidence_has_source check (source_url <> '' or storage_path is not null)
);

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(), commitment_id uuid not null references public.commitments(id) on delete cascade,
  event_date date not null, title text not null, detail text not null,
  event_type text not null check (event_type in ('promise','evidence','status','correction')),
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status public.review_status not null default 'queued', submission_kind text not null default 'promise' check (submission_kind in ('promise','proof')),
  target_commitment_id uuid references public.commitments(id) on delete cascade, title text not null, promise_text text not null,
  source_url text, proof_path text, proof_mime_type text, raw_text text, promised_on date, deadline_start date, deadline date, deadline_label text,
  constraint valid_submission_deadline_window check (deadline_start is null or deadline is null or deadline_start <= deadline),
  state text not null, district text, category text not null, accountable_office text,
  submit_anonymously boolean not null default true, submitter_name text, submitter_email text,
  ai_confidence jsonb not null default '{}'::jsonb, ai_warnings jsonb not null default '[]'::jsonb,
  review_note text, reviewed_at timestamptz, reviewed_by uuid references auth.users(id), published_commitment_id uuid references public.commitments(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint submission_has_proof check (coalesce(source_url,'') <> '' or proof_path is not null),
  constraint proof_targets_commitment check ((submission_kind='promise' and target_commitment_id is null) or (submission_kind='proof' and target_commitment_id is not null)),
  constraint anonymous_hides_identity check (not submit_anonymously or (submitter_name is null and submitter_email is null))
);

create table public.audit_events (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id), entity_type text not null,
  entity_id uuid not null, action text not null, before_data jsonb, after_data jsonb, note text,
  created_at timestamptz not null default now()
);

create table public.ingest_candidates (
  id uuid primary key default gen_random_uuid(), source_url text not null unique, source_text text,
  extracted_draft jsonb not null default '{}'::jsonb, extraction_mode text not null check (extraction_mode in ('ai','heuristic')),
  status text not null default 'candidate' check (status in ('candidate','dismissed','promoted')),
  promoted_submission_id uuid references public.submissions(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.watchers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  commitment_id uuid not null references public.commitments(id) on delete cascade, created_at timestamptz not null default now(), unique(user_id,commitment_id)
);

create index commitments_place_idx on public.commitments(state_slug,district_slug);
create index commitments_status_idx on public.commitments(status,published_at);
create index evidence_commitment_idx on public.evidence(commitment_id,document_date desc);
create index submissions_queue_idx on public.submissions(status,created_at);

alter table public.profiles enable row level security;
alter table public.commitments enable row level security;
alter table public.evidence enable row level security;
alter table public.timeline_events enable row level security;
alter table public.submissions enable row level security;
alter table public.audit_events enable row level security;
alter table public.ingest_candidates enable row level security;
alter table public.watchers enable row level security;

create policy "published commitments are public" on public.commitments for select using (published_at is not null);
create policy "verified evidence is public" on public.evidence for select using (verdict in ('verified','contested') and exists(select 1 from public.commitments c where c.id=commitment_id and c.published_at is not null));
create policy "published timeline is public" on public.timeline_events for select using (exists(select 1 from public.commitments c where c.id=commitment_id and c.published_at is not null));
create policy "users insert their submission" on public.submissions for insert to authenticated with check (user_id=auth.uid() and status='queued');
create policy "users read their submission" on public.submissions for select to authenticated using (user_id=auth.uid());
create policy "users update queued submission" on public.submissions for update to authenticated using (user_id=auth.uid() and status='queued') with check (user_id=auth.uid() and status='queued');
create policy "users manage watches" on public.watchers for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "users read own profile" on public.profiles for select to authenticated using (id=auth.uid());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id) values(new.id) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace view public.commitments_public with (security_invoker=true) as
select c.*,
  coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'title',e.title,'sourceKind',e.source_kind,'sourceUrl',e.source_url,'storagePath',e.storage_path,'mediaType',e.media_type,'quote',e.quote,'direction',e.direction,'verdict',e.verdict,'documentDate',e.document_date,'reviewedAt',e.reviewed_at) order by e.document_date desc) from public.evidence e where e.commitment_id=c.id and e.verdict in ('verified','contested')),'[]'::jsonb) evidence,
  coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'date',t.event_date,'title',t.title,'detail',t.detail,'type',t.event_type) order by t.event_date) from public.timeline_events t where t.commitment_id=c.id),'[]'::jsonb) timeline
from public.commitments c where c.published_at is not null;
grant select on public.commitments_public to anon, authenticated;

create or replace function public.review_submission(p_submission_id uuid,p_decision text,p_note text,p_progress_after smallint default null,p_mark_completed boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.submissions; c_id uuid; reviewer_role public.app_role; verified_progress smallint;
begin
  select role into reviewer_role from public.profiles where id=auth.uid();
  if reviewer_role not in ('reviewer','admin') then raise exception 'reviewer access required'; end if;
  if p_decision not in ('accepted','rejected','needs_info') then raise exception 'invalid decision'; end if;
  select * into s from public.submissions where id=p_submission_id and status='queued' for update;
  if not found then raise exception 'queued submission not found'; end if;
  if s.user_id=auth.uid() and reviewer_role<>'admin' then raise exception 'reviewers cannot decide their own submissions'; end if;
  if p_decision='accepted' then
    if s.submission_kind='proof' then
      if s.target_commitment_id is null then raise exception 'proof target not found'; end if;
      c_id:=s.target_commitment_id;
      select case when p_mark_completed then 100 else greatest(progress,coalesce(p_progress_after,progress)) end into verified_progress from public.commitments where id=c_id for update;
      insert into public.evidence(commitment_id,kind,title,source_kind,source_url,storage_path,media_type,quote,direction,verdict,document_date,reviewed_at,reviewed_by)
      values(c_id,'proof',s.title,case when s.proof_path is null then 'press_link' else 'signed_document' end,coalesce(s.source_url,''),s.proof_path,s.proof_mime_type,left(s.promise_text,500),'supports','verified',coalesce(s.promised_on,current_date),now(),auth.uid());
      update public.commitments set progress=verified_progress,status=case when p_mark_completed or verified_progress=100 then 'fulfilled'::public.commitment_status when status='fulfilled' then status else 'in_progress'::public.commitment_status end,updated_at=now() where id=c_id;
      insert into public.timeline_events(commitment_id,event_date,title,detail,event_type) values(c_id,current_date,case when p_mark_completed or verified_progress=100 then 'Promise marked complete' else 'Verified progress updated' end,p_note,'status');
    else
      insert into public.commitments(slug,title,detail,state,state_slug,district,district_slug,category,status,promised_on,deadline_start,deadline,deadline_label,progress,beneficiaries,accountable_office,published_at)
      values(lower(regexp_replace(s.title,'[^a-zA-Z0-9]+','-','g'))||'-'||left(s.id::text,8),s.title,s.promise_text,s.state,lower(regexp_replace(s.state,'[^a-zA-Z0-9]+','-','g')),coalesce(s.district,'Not stated'),lower(regexp_replace(coalesce(s.district,'not-stated'),'[^a-zA-Z0-9]+','-','g')),s.category,'promised',coalesce(s.promised_on,current_date),s.deadline_start,s.deadline,s.deadline_label,0,'Not stated',coalesce(s.accountable_office,'Not stated'),now()) returning id into c_id;
      insert into public.evidence(commitment_id,kind,title,source_kind,source_url,storage_path,media_type,quote,verdict,document_date,reviewed_at,reviewed_by) values(c_id,'receipt','Original submitted source',case when s.proof_path is null then 'press_link' else 'signed_document' end,coalesce(s.source_url,''),s.proof_path,s.proof_mime_type,left(s.promise_text,500),'verified',coalesce(s.promised_on,current_date),now(),auth.uid());
      insert into public.timeline_events(commitment_id,event_date,title,detail,event_type) values(c_id,coalesce(s.promised_on,current_date),'Promise recorded','Accepted after human review of the original source.','promise');
    end if;
  end if;
  update public.submissions set status=p_decision::public.review_status,review_note=p_note,reviewed_at=now(),reviewed_by=auth.uid(),published_commitment_id=c_id,updated_at=now() where id=s.id;
  insert into public.audit_events(actor_id,entity_type,entity_id,action,before_data,after_data,note) values(auth.uid(),'submission',s.id,'review_decision',to_jsonb(s),jsonb_build_object('status',p_decision,'published_commitment_id',c_id),p_note);
  return jsonb_build_object('submission_id',s.id,'decision',p_decision,'commitment_id',c_id);
end $$;
revoke all on function public.review_submission(uuid,text,text,smallint,boolean) from public; grant execute on function public.review_submission(uuid,text,text,smallint,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('proof-media','proof-media',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do update set public=false;
create policy "users upload own proof" on storage.objects for insert to authenticated with check(bucket_id='proof-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users read own proof" on storage.objects for select to authenticated using(bucket_id='proof-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- Grant reviewer/admin by changing an existing profile after creating the account:
-- update public.profiles set role='reviewer' where id='<auth-user-uuid>';
