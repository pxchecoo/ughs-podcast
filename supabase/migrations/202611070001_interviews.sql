-- Apply once using Supabase migrations, first in an isolated staging project.
-- Deliberately fail on a table-name collision; never overwrite existing tables.
begin;
create table public.interview_staff (
 user_id uuid primary key references auth.users(id) on delete restrict,
 role text not null check(role in ('moderator','admin')),
 active boolean not null default true,
 can_export boolean not null default false,
 can_delete boolean not null default false,
 created_at timestamptz not null default now(),
 check(role = 'admin' or (not can_export and not can_delete))
);
create table public.interview_requests (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(length(full_name) between 2 and 120),
 email text not null check(length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 school_affiliation text check(length(school_affiliation) <= 120),
 topic text not null check(length(topic) between 3 and 180),
 motivation text not null check(length(motivation) between 10 and 2000),
 previous_experience boolean,
 status text not null default 'pending' check(status in ('pending','in_review','approved','rejected')),
 consent_contact boolean not null check(consent_contact),
 consent_version text not null check(length(consent_version) between 1 and 64),
 consent_policy_reference text not null,
 consent_accepted_at timestamptz not null default now(),
 reviewed_by uuid references public.interview_staff(user_id) on delete restrict,
 reviewed_at timestamptz,
 internal_notes text check(length(internal_notes) <= 4000),
 submission_key_hash text not null unique check(submission_key_hash ~ '^[a-f0-9]{64}$'),
 submission_payload_hash text not null check(submission_payload_hash ~ '^[a-f0-9]{64}$'),
 revision integer not null default 1 check(revision > 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index interview_requests_created_idx on public.interview_requests(created_at desc, id);
create index interview_requests_status_created_idx on public.interview_requests(status, created_at desc);
create table public.interview_request_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid references public.interview_requests(id) on delete set null,
 event_type text not null check(event_type in ('submitted','reviewed','exported','deleted')),
 old_status text check(old_status in ('pending','in_review','approved','rejected')),
 new_status text check(new_status in ('pending','in_review','approved','rejected')),
 actor_id uuid references public.interview_staff(user_id) on delete restrict,
 notes_changed boolean not null default false,
 created_at timestamptz not null default now()
);
create index interview_events_request_idx on public.interview_request_events(request_id, created_at);
create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(),
 event_type text not null default 'interview_submitted' check(event_type = 'interview_submitted'),
 request_id uuid not null references public.interview_requests(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
 attempts integer not null default 0 check(attempts between 0 and 6),
 next_attempt_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), first_attempt_at timestamptz,
 sent_at timestamptz, provider_id text, error_code text,
 unique(event_type, request_id)
);
create index notification_due_idx on public.notification_outbox(next_attempt_at) where status in ('pending','processing');
create table public.database_health_runs (
 id uuid primary key, mode text not null check(mode in ('full','connectivity')),
 status text not null check(status in ('ok','failed')),
 connectivity boolean not null default false, insertion boolean, readback boolean, deletion boolean,
 duration_ms integer not null check(duration_ms >= 0), error_code text check(length(error_code) <= 80),
 created_at timestamptz not null, finished_at timestamptz not null default now()
);
create index database_health_runs_created_idx on public.database_health_runs(created_at desc);
create table public.database_health_checks (
 id uuid primary key, run_id uuid not null unique, technical_value text not null check(length(technical_value) <= 128),
 created_at timestamptz not null default now()
);
create index database_health_checks_created_idx on public.database_health_checks(created_at);

create function public.uev_touch_request() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = clock_timestamp(); return new; end $$;
create trigger interview_touch before update on public.interview_requests for each row execute function public.uev_touch_request();

create function public.uev_require_staff(p_actor uuid, p_permission text default 'review') returns void
language plpgsql security definer set search_path = '' as $$
declare s public.interview_staff;
begin
 select * into s from public.interview_staff where user_id = p_actor and active;
 if s.user_id is null or (p_permission = 'admin' and s.role <> 'admin')
 or (p_permission = 'export' and (s.role <> 'admin' or not s.can_export))
 or (p_permission = 'delete' and (s.role <> 'admin' or not s.can_delete))
 or p_permission not in ('review','admin','export','delete') then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create function public.uev_submit_interview(p_data jsonb, p_key_hash text, p_payload_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid; existing_hash text;
begin
 -- Server owns administrative values. This function is executable only by service_role.
 if p_data->>'consent_version' <> '2026-11-07.v1' or (p_data->>'consent_contact')::boolean is distinct from true then
 raise exception 'invalid consent' using errcode = '22023'; end if;
 insert into public.interview_requests(full_name,email,school_affiliation,topic,motivation,previous_experience,
 consent_contact,consent_version,consent_policy_reference,submission_key_hash,submission_payload_hash)
 values(p_data->>'full_name',p_data->>'email',nullif(p_data->>'school_affiliation',''),p_data->>'topic',p_data->>'motivation',
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

create function public.uev_review_interview(p_actor uuid,p_id uuid,p_revision integer,p_status text,p_notes text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests; result public.interview_requests;
begin
 perform public.uev_require_staff(p_actor);
 select * into r from public.interview_requests where id = p_id for update;
 if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
 if r.revision <> p_revision then raise exception 'conflict' using errcode = '40001'; end if;
 -- Final decisions may be reopened for review, never changed directly to the opposite final decision.
 if p_status is null or p_status not in ('pending','in_review','approved','rejected') or not (
 p_status = r.status or (r.status = 'pending' and p_status in ('in_review','rejected')) or
 (r.status = 'in_review' and p_status in ('pending','approved','rejected')) or
 (r.status in ('approved','rejected') and p_status = 'in_review')) then raise exception 'invalid transition' using errcode = '22023'; end if;
 update public.interview_requests set status=p_status,internal_notes=p_notes,reviewed_by=p_actor,reviewed_at=now(),revision=revision+1
 where id=p_id returning * into result;
 insert into public.interview_request_events(request_id,event_type,old_status,new_status,actor_id,notes_changed)
 values(p_id,'reviewed',r.status,p_status,p_actor,r.internal_notes is distinct from p_notes);
 return to_jsonb(result) - 'submission_key_hash' - 'submission_payload_hash';
end $$;

create function public.uev_export_interview(p_actor uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests;
begin
 perform public.uev_require_staff(p_actor,'export');
 select * into r from public.interview_requests where id=p_id;
 if r.id is null then raise exception 'not found' using errcode='P0002'; end if;
 insert into public.interview_request_events(request_id,event_type,actor_id) values(p_id,'exported',p_actor);
 return to_jsonb(r) - 'submission_key_hash' - 'submission_payload_hash';
end $$;
create function public.uev_delete_interview(p_actor uuid,p_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests;
begin
 perform public.uev_require_staff(p_actor,'delete');
 select * into r from public.interview_requests where id=p_id for update;
 if r.id is null then raise exception 'not found' using errcode='P0002'; end if;
 if r.revision <> p_revision then raise exception 'conflict' using errcode='40001'; end if;
 insert into public.interview_request_events(request_id,event_type,actor_id,old_status) values(p_id,'deleted',p_actor,r.status);
 delete from public.interview_requests where id=p_id;
end $$;

-- Claims use row locks + expiring leases; completion must own the lease token.
create function public.uev_claim_notifications(p_request_id uuid default null) returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
 update public.notification_outbox set status='failed',error_code='RETRY_WINDOW_EXPIRED',lease_token=null,lease_until=null
 where status in ('pending','processing') and (lease_until is null or lease_until < now())
 and (attempts >= 6 or first_attempt_at < now() - interval '7 days');
 return query with candidates as (
 select id from public.notification_outbox where status in ('pending','processing') and attempts < 6 and next_attempt_at <= now()
 and (lease_until is null or lease_until < now()) and (p_request_id is null or request_id=p_request_id)
 order by created_at limit 3 for update skip locked)
 update public.notification_outbox o set status='processing',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),
 lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' from candidates c where o.id=c.id returning o.*;
end $$;
create function public.uev_finish_notification(p_id uuid,p_lease uuid,p_provider_id text,p_error text,p_retry boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
 update public.notification_outbox set status=case when p_provider_id is not null then 'sent'
 when p_retry and attempts < 6 and first_attempt_at > now()-interval '7 days' then 'pending' else 'failed' end,
 sent_at=case when p_provider_id is not null then now() else null end,provider_id=p_provider_id,error_code=p_error,
 next_attempt_at=now()+make_interval(secs => least(3600,60*power(2,attempts)::integer)),lease_token=null,lease_until=null
 where id=p_id and lease_token=p_lease and status='processing' and lease_until > now();
 if not found then raise exception 'lease lost' using errcode='40001'; end if;
end $$;

create function public.uev_cleanup_technical() returns void language plpgsql security definer set search_path = '' as $$
begin
 -- Active full runs are bounded to 120s and lease to 300s. No active run can be 48h old.
 delete from public.database_health_checks where created_at < now()-interval '48 hours';
 delete from public.database_health_runs where created_at < now()-interval '30 days';
 -- Keep dead letters for operator review; no applicant retention deletion here.
 delete from public.notification_outbox where status='sent' and sent_at < now()-interval '30 days';
end $$;

create function public.uev_list_interviews(p_actor uuid,p_page integer,p_status text,p_search text,p_order text)
returns table(id uuid,full_name text,topic text,status text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 perform public.uev_require_staff(p_actor);
 if p_page < 1 or p_page > 400 or length(p_search) > 80 or p_order not in ('asc','desc')
 or (p_status is not null and p_status not in ('pending','in_review','approved','rejected')) then raise exception 'invalid query' using errcode='22023'; end if;
 return query select r.id,r.full_name,r.topic,r.status,r.created_at from public.interview_requests r
 where (p_status is null or r.status=p_status) and (p_search='' or
 strpos(lower(r.full_name || ' ' || r.topic), lower(p_search)) > 0)
 order by case when p_order='asc' then r.created_at end asc,
 case when p_order='desc' then r.created_at end desc, r.id limit 21 offset ((p_page-1)*20);
end $$;

-- No browser/authenticated access; verified external sessions use controlled server APIs.
do $$ declare t text; begin
 foreach t in array array['interview_staff','interview_requests','interview_request_events','notification_outbox','database_health_checks','database_health_runs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
 execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;
grant insert,delete on public.database_health_checks to service_role;
grant insert on public.database_health_runs to service_role;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'uev\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 -- Helpers are not public RPC entry points, even for the server.
 if f.sig::text not like '%uev_require_staff%' and f.sig::text not like '%uev_touch_request%' then
 execute format('grant execute on function %s to service_role',f.sig); end if;
 end loop;
end $$;
commit;
