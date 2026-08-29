-- Fix RLS policies for profile access and media assets

-- Add policy for permanent users to read their own profile (explicit)
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'profiles' and policyname = 'permanent users read own profile'
  ) then
    create policy "permanent users read own profile" on public.profiles 
    for select to authenticated 
    using (id=auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);
  end if;
end $$;

-- Add policy for permanent users to update their own profile
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'profiles' and policyname = 'permanent users update own profile'
  ) then
    create policy "permanent users update own profile" on public.profiles 
    for update to authenticated 
    using (id=auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false)
    with check (id=auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);
  end if;
end $$;

-- Add policy for permanent users to insert their own profile (in case trigger fails)
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'profiles' and policyname = 'permanent users insert own profile'
  ) then
    create policy "permanent users insert own profile" on public.profiles 
    for insert to authenticated 
    with check (id=auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);
  end if;
end $$;

-- Add policy for permanent users to upload media
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'media_assets' and policyname = 'permanent users insert media'
  ) then
    create policy "permanent users insert media" on public.media_assets 
    for insert to authenticated 
    with check (owner_id=auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);
  end if;
end $$;

-- Add policy for permanent users to update their media
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'media_assets' and policyname = 'permanent users update own media'
  ) then
    create policy "permanent users update own media" on public.media_assets 
    for update to authenticated 
    using (owner_id=auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false)
    with check (owner_id=auth.uid() and (auth.jwt()->>'is_anonymous')::boolean is false);
  end if;
end $$;

-- Ensure profiles RLS is enabled
alter table public.profiles enable row level security;
alter table public.media_assets enable row level security;
