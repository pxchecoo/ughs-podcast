-- Prepared and tested locally only. Apply to production only after approval.
-- Additive schema change: no existing request is deleted or moved to the trash.
begin;
alter table public.interview_requests
 add column deleted_at timestamptz,
 add column deleted_by uuid references public.interview_staff(user_id) on delete restrict,
 add constraint interview_deletion_pair check ((deleted_at is null) = (deleted_by is null));
alter table public.interview_staff
 add column can_purge boolean not null default false,
 add constraint interview_purge_permission check (not can_purge or (role = 'admin' and can_delete));
-- No accounts are granted additional permissions by this migration.
alter table public.interview_request_events drop constraint interview_request_events_event_type_check;
alter table public.interview_request_events add constraint interview_request_events_event_type_check
 check(event_type in ('submitted','reviewed','exported','deleted','trashed','restored'));
create index interview_requests_active_idx on public.interview_requests(created_at desc, id) where deleted_at is null;
create index interview_requests_trash_idx on public.interview_requests(created_at desc, id) where deleted_at is not null;
create or replace function public.uev_require_staff(p_actor uuid, p_permission text default 'review') returns void
language plpgsql security definer set search_path = '' as $$
declare s public.interview_staff;
begin
 select * into s from public.interview_staff where user_id = p_actor and active;
 if s.user_id is null or (p_permission = 'admin' and s.role <> 'admin')
 or (p_permission = 'export' and (s.role <> 'admin' or not s.can_export))
 or (p_permission = 'delete' and (s.role <> 'admin' or not s.can_delete))
 or (p_permission = 'purge' and (s.role <> 'admin' or not s.can_delete or not s.can_purge))
 or p_permission not in ('review','admin','export','delete','purge') then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.uev_review_interview(p_actor uuid,p_id uuid,p_revision integer,p_status text,p_notes text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests; result public.interview_requests;
begin
 perform public.uev_require_staff(p_actor);
 select * into r from public.interview_requests where id = p_id and deleted_at is null for update;
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

create or replace function public.uev_export_interview(p_actor uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests;
begin
 perform public.uev_require_staff(p_actor,'export');
 select * into r from public.interview_requests where id=p_id and deleted_at is null;
 if r.id is null then raise exception 'not found' using errcode='P0002'; end if;
 insert into public.interview_request_events(request_id,event_type,actor_id) values(p_id,'exported',p_actor);
 return to_jsonb(r) - 'submission_key_hash' - 'submission_payload_hash';
end $$;

create or replace function public.uev_list_interviews(p_actor uuid,p_page integer,p_status text,p_search text,p_order text)
returns table(id uuid,full_name text,topic text,status text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 perform public.uev_require_staff(p_actor);
 if p_page < 1 or p_page > 400 or length(p_search) > 80 or p_order not in ('asc','desc')
 or (p_status is not null and p_status not in ('pending','in_review','approved','rejected')) then raise exception 'invalid query' using errcode='22023'; end if;
 return query select r.id,r.full_name,r.topic,r.status,r.created_at from public.interview_requests r
 where r.deleted_at is null and (p_status is null or r.status=p_status) and (p_search='' or
 strpos(lower(r.full_name || ' ' || r.topic), lower(p_search)) > 0)
 order by case when p_order='asc' then r.created_at end asc,
 case when p_order='desc' then r.created_at end desc, r.id limit 21 offset ((p_page-1)*20);
end $$;

create or replace function public.uev_list_interview_trash(p_actor uuid,p_page integer,p_status text,p_search text,p_order text)
returns table(id uuid,full_name text,topic text,status text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 perform public.uev_require_staff(p_actor,'delete');
 if p_page < 1 or p_page > 400 or length(p_search) > 80 or p_order not in ('asc','desc')
 or (p_status is not null and p_status not in ('pending','in_review','approved','rejected')) then raise exception 'invalid query' using errcode='22023'; end if;
 return query select r.id,r.full_name,r.topic,r.status,r.created_at from public.interview_requests r
 where r.deleted_at is not null and (p_status is null or r.status=p_status) and (p_search='' or
 strpos(lower(r.full_name || ' ' || r.topic), lower(p_search)) > 0)
 order by case when p_order='asc' then r.created_at end asc,
 case when p_order='desc' then r.created_at end desc, r.id limit 21 offset ((p_page-1)*20);
end $$;

create function public.uev_trash_interview(p_actor uuid,p_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests;
begin
 perform public.uev_require_staff(p_actor,'delete');
 if p_id is null or p_revision is null or p_revision < 1 then raise exception 'invalid request' using errcode='22023'; end if;
 select * into r from public.interview_requests where id=p_id for update;
 if r.id is null then raise exception 'not found' using errcode='P0002'; end if;
 if r.revision <> p_revision or r.deleted_at is not null then raise exception 'conflict' using errcode='40001'; end if;
 update public.interview_requests set deleted_at=now(),deleted_by=p_actor,revision=revision+1 where id=p_id;
 insert into public.interview_request_events(request_id,event_type,actor_id,old_status) values(p_id,'trashed',p_actor,r.status);
end $$;

create function public.uev_restore_interview(p_actor uuid,p_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests;
begin
 perform public.uev_require_staff(p_actor,'delete');
 if p_id is null or p_revision is null or p_revision < 1 then raise exception 'invalid request' using errcode='22023'; end if;
 select * into r from public.interview_requests where id=p_id for update;
 if r.id is null then raise exception 'not found' using errcode='P0002'; end if;
 if r.revision <> p_revision or r.deleted_at is null then raise exception 'conflict' using errcode='40001'; end if;
 update public.interview_requests set deleted_at=null,deleted_by=null,revision=revision+1 where id=p_id;
 insert into public.interview_request_events(request_id,event_type,actor_id,new_status) values(p_id,'restored',p_actor,r.status);
end $$;

-- Replace the original hard-delete entry point too: legacy callers cannot bypass
-- the trash requirement or the additional explicit permanent-deletion permission.
create or replace function public.uev_delete_interview(p_actor uuid,p_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.interview_requests;
begin
 perform public.uev_require_staff(p_actor,'purge');
 if p_id is null or p_revision is null or p_revision < 1 then raise exception 'invalid request' using errcode='22023'; end if;
 select * into r from public.interview_requests where id=p_id for update;
 if r.id is null then raise exception 'not found' using errcode='P0002'; end if;
 if r.revision <> p_revision or r.deleted_at is null then raise exception 'conflict' using errcode='40001'; end if;
 insert into public.interview_request_events(request_id,event_type,actor_id,old_status) values(p_id,'deleted',p_actor,r.status);
 -- Existing FK rules remove the outbox and unlink audit references. Audit retains
 -- only technical fields (no name/email/topic/notes/payload or original request ID).
 delete from public.interview_requests where id=p_id;
end $$;

-- Preserve the server-only RLS model. No browser grants, policies or new tables.
revoke all on function public.uev_trash_interview(uuid,uuid,integer),
 public.uev_restore_interview(uuid,uuid,integer),
 public.uev_list_interview_trash(uuid,integer,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.uev_trash_interview(uuid,uuid,integer),
 public.uev_restore_interview(uuid,uuid,integer),
 public.uev_list_interview_trash(uuid,integer,text,text,text) to service_role;
commit;
