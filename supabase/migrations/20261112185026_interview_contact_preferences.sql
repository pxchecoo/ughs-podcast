-- Additive migration: no backfill, deletion or changes to RLS/staff permissions.
begin;
alter table public.interview_requests
 add column phone_number text,
 add column preferred_contact_method text,
 add constraint interview_phone_format check (
   phone_number is null or (
     phone_number ~ '^\+[1-9][0-9]{7,14}$'
     and (phone_number not like '+1%' or phone_number ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$')
   )
 ),
 add constraint interview_contact_method check (preferred_contact_method in ('phone','email')),
 add constraint interview_phone_required check (preferred_contact_method is distinct from 'phone' or phone_number is not null);

create or replace function public.uev_submit_interview(p_data jsonb, p_key_hash text, p_payload_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid; existing_hash text;
begin
 -- Server owns administrative values. This function is executable only by service_role.
 if p_data->>'consent_version' <> '2026-11-07.v1' or (p_data->>'consent_contact')::boolean is distinct from true then
 raise exception 'invalid consent' using errcode = '22023'; end if;
 -- Accept the legacy server payload during a rolling release. The current HTTP
 -- validator always requires an explicit method. Existing rows stay NULL.
 if p_data ? 'preferred_contact_method' or p_data ? 'phone_number' then
   if coalesce(p_data->>'preferred_contact_method','') not in ('phone','email')
      or jsonb_typeof(p_data->'preferred_contact_method') is distinct from 'string'
      or (p_data ? 'phone_number' and jsonb_typeof(p_data->'phone_number') not in ('string','null')) then
     raise exception 'invalid contact data' using errcode = '22023';
   end if;
 end if;
 insert into public.interview_requests(full_name,email,phone_number,preferred_contact_method,school_affiliation,topic,motivation,previous_experience,
 consent_contact,consent_version,consent_policy_reference,submission_key_hash,submission_payload_hash)
 values(p_data->>'full_name',p_data->>'email',nullif(p_data->>'phone_number',''),p_data->>'preferred_contact_method',nullif(p_data->>'school_affiliation',''),p_data->>'topic',p_data->>'motivation',
 (p_data->>'previous_experience')::boolean,true,'2026-11-07.v1','/privacy/#2026-11-07-v1',p_key_hash,p_payload_hash)
 on conflict(submission_key_hash) do nothing returning id into rid;
 if rid is null then
 select id, submission_payload_hash into rid, existing_hash from public.interview_requests where submission_key_hash = p_key_hash;
 if existing_hash <> p_payload_hash then raise exception 'idempotency mismatch' using errcode = '22023'; end if;
 return rid;
 end if;
 insert into public.interview_request_events(request_id,event_type,new_status) values(rid,'submitted','pending');
 insert into public.notification_outbox(request_id) values(rid);
 return rid;
end $$;

-- CREATE OR REPLACE preserves the existing server-only EXECUTE grants.
revoke all on function public.uev_submit_interview(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.uev_submit_interview(jsonb,text,text) to service_role;
commit;
