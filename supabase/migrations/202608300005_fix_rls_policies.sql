-- Fix RLS policies for media assets and profiles
-- This migration ensures proper access control for all authenticated users

-- Enable RLS on tables
alter table public.profiles enable row level security;
alter table public.media_assets enable row level security;

-- ==============================================================
-- PROFILES TABLE - Allow permanent users to read/update their profile
-- ==============================================================

-- Drop existing conflicting policies if they exist (safe to do)
drop policy if exists "permanent users read own profile" on public.profiles;
drop policy if exists "permanent users update own profile" on public.profiles;
drop policy if exists "permanent users insert own profile" on public.profiles;

-- Policy: Permanent users can read their own profile
create policy "permanent users read own profile" on public.profiles
for select to authenticated
using (id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

-- Policy: Permanent users can update their own profile
create policy "permanent users update own profile" on public.profiles
for update to authenticated
using (id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false)
with check (id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

-- Policy: Permanent users can insert their own profile (backup for trigger)
create policy "permanent users insert own profile" on public.profiles
for insert to authenticated
with check (id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

-- ==============================================================
-- MEDIA_ASSETS TABLE - Allow permanent users to upload and manage media
-- ==============================================================

-- Drop existing conflicting policies if they exist
drop policy if exists "permanent users insert media" on public.media_assets;
drop policy if exists "permanent users update own media" on public.media_assets;
drop policy if exists "permanent users read own media metadata" on public.media_assets;

-- Policy: Permanent users can insert (upload) media assets
create policy "permanent users insert media" on public.media_assets
for insert to authenticated
with check (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

-- Policy: Permanent users can update their own media assets
create policy "permanent users update own media" on public.media_assets
for update to authenticated
using (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false)
with check (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);

-- Policy: Permanent users can read their own media metadata
create policy "permanent users read own media metadata" on public.media_assets
for select to authenticated
using (owner_id = auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);
