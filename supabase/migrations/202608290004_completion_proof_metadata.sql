create or replace function public.normalize_completion_proof_submission() returns trigger language plpgsql set search_path='' as $$
declare target_title text;
begin
  if new.submission_kind='proof' then
    select title into target_title from public.commitments where id=new.target_commitment_id;
    if target_title is null then raise exception 'proof target not found'; end if;
    new.title:=left('Completion proof for '||target_title,180);
    new.promise_text:=left('Completion evidence submitted for the public promise: '||target_title,10000);
    new.promised_on:=null; new.deadline_start:=null; new.deadline:=null; new.deadline_label:=null;
    new.raw_text:=null; new.ai_confidence:='{}'::jsonb; new.ai_warnings:='[]'::jsonb;
  end if;
  return new;
end $$;

drop trigger if exists normalize_completion_proof_metadata on public.submissions;
create trigger normalize_completion_proof_metadata before insert on public.submissions for each row execute function public.normalize_completion_proof_submission();
