-- Add news reporters as a self-described contributor type without granting reviewer access.
alter table public.profiles drop constraint if exists profiles_contributor_type_check;
alter table public.profiles add constraint profiles_contributor_type_check
  check (contributor_type in ('citizen','government_official','news_reporter'));

create or replace function public.update_my_profile(p_display_name text,p_contributor_type text,p_default_submit_anonymously boolean)
returns table(role public.app_role,display_name text,contributor_type text,default_submit_anonymously boolean,preferences_configured_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); before_profile jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_contributor_type not in ('citizen','government_official','news_reporter') then raise exception 'invalid contributor type'; end if;
  if char_length(trim(p_display_name))>120 then raise exception 'display name is too long'; end if;
  if not p_default_submit_anonymously and char_length(trim(p_display_name))<2 then raise exception 'display name required for public credit'; end if;
  select to_jsonb(p) into before_profile from public.profiles p where p.id=actor for update;
  if before_profile is null then raise exception 'profile not found'; end if;
  return query update public.profiles p set display_name=nullif(trim(p_display_name),''),contributor_type=p_contributor_type,default_submit_anonymously=p_default_submit_anonymously,preferences_configured_at=now(),updated_at=now() where p.id=actor returning p.role,p.display_name,p.contributor_type,p.default_submit_anonymously,p.preferences_configured_at,p.updated_at;
  insert into public.audit_events(actor_id,entity_type,entity_id,action,before_data,after_data,note) select actor,'profile',actor,'preferences_updated',before_profile,to_jsonb(p),'User updated contributor and public-credit defaults.' from public.profiles p where p.id=actor;
end $$;

revoke all on function public.update_my_profile(text,text,boolean) from public;
grant execute on function public.update_my_profile(text,text,boolean) to authenticated;
