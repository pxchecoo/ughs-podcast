-- Run after migration in staging using SQL Editor/owner. Rolls back all test state.
begin;
reset role;
do $$ declare t text; begin
 foreach t in array array['interview_staff','interview_requests','interview_request_events','notification_outbox','database_health_checks','database_health_runs'] loop
 if has_table_privilege('anon','public.'||t,'select,insert,update,delete') or has_table_privilege('authenticated','public.'||t,'select,insert,update,delete') then
 raise exception 'unexpected browser grant on %',t; end if;
 end loop;
 if has_function_privilege('anon','public.uev_submit_interview(jsonb,text,text)','execute') then raise exception 'anonymous RPC grant'; end if;
 if not has_function_privilege('service_role','public.uev_submit_interview(jsonb,text,text)','execute') then raise exception 'missing server RPC grant'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform * from public.interview_requests; raise exception 'anon SELECT unexpectedly allowed'; exception when insufficient_privilege then null; end;
 begin update public.interview_requests set status='approved'; raise exception 'anon UPDATE unexpectedly allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.interview_requests; raise exception 'anon DELETE unexpectedly allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
