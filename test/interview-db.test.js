import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createInterviewHandler } from '../api/interview-requests.js';
import { createInterviewAdminHandler } from '../api/interview-admin.js';
import { AppError, authorizeStaff, STAFF_COOKIE } from '../lib/interview-server.js';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const mod='11111111-1111-4111-8111-111111111111', admin='22222222-2222-4222-8222-222222222222';
const payload = { full_name:'Persona de prueba', email:'example@example.test', school_affiliation:'', topic:'Tema de prueba',motivation:'Una motivación de prueba.',previous_experience:null,consent_contact:true,consent_version:'2026-11-07.v1' };
const hash='a'.repeat(64), ph='b'.repeat(64);
test('isolated PostgreSQL migration, transactions, SQL permissions and retention', async t => {
  const db=new PGlite();
  try {
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users(id uuid primary key);');
    for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
    await db.query('insert into auth.users(id) values($1),($2)',[mod,admin]);
    await db.query("insert into interview_staff(user_id,role,can_export,can_delete) values($1,'moderator',false,false),($2,'admin',true,true)",[mod,admin]);
    let id;
    await t.test('atomic request + submitted event + outbox with server defaults',async()=>{
      await db.exec('set role service_role');
      id=(await db.query('select uev_submit_interview($1,$2,$3) id',[JSON.stringify(payload),hash,ph])).rows[0].id;
      const {rows:[row]}=await db.query('select * from interview_requests where id=$1',[id]);
      assert.equal(row.status,'pending');assert.equal(row.revision,1);assert.equal(row.consent_contact,true);assert.ok(row.created_at);assert.ok(row.consent_accepted_at);
      assert.equal((await db.query('select * from notification_outbox')).rows.length,1);
      assert.equal((await db.query('select * from interview_request_events')).rows.length,1);
    });
    await t.test('retry returns same id without extra request, event or notification',async()=>{
      assert.equal((await db.query('select uev_submit_interview($1,$2,$3) id',[JSON.stringify(payload),hash,ph])).rows[0].id,id);
      assert.equal((await db.query('select * from notification_outbox')).rows.length,1);
      await assert.rejects(db.query('select uev_submit_interview($1,$2,$3)',[JSON.stringify(payload),hash,'c'.repeat(64)]),e=>e.code==='22023');
    });
    await t.test('constraints reject invalid data and rollback notification atomically',async()=>{
      await assert.rejects(db.query('select uev_submit_interview($1,$2,$3)',[JSON.stringify({...payload,full_name:'x'}),'c'.repeat(64),ph]),e=>e.code==='23514');
      await assert.rejects(db.query('select uev_submit_interview($1,$2,$3)',[JSON.stringify({...payload,consent_contact:false}),'d'.repeat(64),ph]),e=>e.code==='22023');
      assert.equal((await db.query('select * from interview_requests')).rows.length,1);
    });
    await t.test('all six tables enable RLS',async()=>{
      await db.exec('reset role'); const {rows}=await db.query("select relrowsecurity from pg_class where relname in ('interview_staff','interview_requests','interview_request_events','notification_outbox','database_health_checks','database_health_runs')");
      assert.equal(rows.length,6);assert.ok(rows.every(r=>r.relrowsecurity));
    });
    for(const role of ['anon','authenticated']) {
      await t.test(`${role} denied SELECT/UPDATE/DELETE and privileged RPC`,async()=>{
        await db.exec(`set role ${role}`);
        for(const table of ['interview_staff','interview_requests','interview_request_events','notification_outbox','database_health_checks','database_health_runs']) {
          for(const sql of [`select * from ${table}`,`delete from ${table}`]) await assert.rejects(db.query(sql),e=>e.code==='42501');
        }
        await assert.rejects(db.query("update interview_requests set status='approved'"),e=>e.code==='42501');
        await assert.rejects(db.query('select uev_submit_interview($1,$2,$3)',[JSON.stringify(payload),hash,ph]),e=>e.code==='42501');
        await assert.rejects(db.query('select uev_review_interview($1,$2,1,$3,$4)',[mod,id,'in_review','nota']),e=>e.code==='42501');
      });
    }
    await t.test('service cannot alter staff or audit directly',async()=>{
      await db.exec('set role service_role');
      await assert.rejects(db.query("update interview_staff set role='admin'"),e=>e.code==='42501');
      await assert.rejects(db.query('delete from interview_request_events'),e=>e.code==='42501');
      await assert.rejects(db.query("update interview_requests set status='approved'"),e=>e.code==='42501');
    });
    await t.test('moderator review and audit are atomic; stale revision rejected',async()=>{
      const {rows:[r]}=await db.query('select uev_review_interview($1,$2,1,$3,$4) result',[mod,id,'in_review','nota privada']);
      assert.equal(r.result.revision,2);assert.equal(r.result.reviewed_by,mod);assert.equal(r.result.submission_key_hash,undefined);
      await assert.rejects(db.query('select uev_review_interview($1,$2,1,$3,$4)',[mod,id,'approved','stale']),e=>e.code==='40001');
      const events=(await db.query('select * from interview_request_events where event_type=$1',['reviewed'])).rows;
      assert.equal(events.length,1);assert.equal(events[0].notes_changed,true);assert.equal(events[0].old_status,'pending');assert.equal(events[0].new_status,'in_review');
      assert.equal(JSON.stringify(events).includes('nota privada'),false);
    });
    await t.test('state transition enforcement and reopening final decision',async()=>{
      await db.query('select uev_review_interview($1,$2,2,$3,$4)',[mod,id,'approved','nota privada']);
      await assert.rejects(db.query('select uev_review_interview($1,$2,3,$3,$4)',[mod,id,'rejected','']),e=>e.code==='22023');
      await db.query('select uev_review_interview($1,$2,3,$3,$4)',[mod,id,'in_review','']);
    });
    await t.test('moderator denied export/delete and inactive staff denied review',async()=>{
      await assert.rejects(db.query('select uev_export_interview($1,$2)',[mod,id]),e=>e.code==='42501');
      await assert.rejects(db.query('select uev_delete_interview($1,$2,4)',[mod,id]),e=>e.code==='42501');
      await db.exec('reset role');await db.query('update interview_staff set active=false where user_id=$1',[mod]);await db.exec('set role service_role');
      await assert.rejects(db.query('select uev_review_interview($1,$2,4,$3,$4)',[mod,id,'rejected','']),e=>e.code==='42501');
      await db.exec('reset role');await db.query('update interview_staff set active=true where user_id=$1',[mod]);await db.exec('set role service_role');
    });
    await t.test('search is literal, paginated and permission-checked',async()=>{
      assert.equal((await db.query('select * from uev_list_interviews($1,1,null,$2,$3)',[mod,'Persona','desc'])).rows.length,1);
      assert.equal((await db.query('select * from uev_list_interviews($1,1,null,$2,$3)',[mod,"'),id.neq.null",'desc'])).rows.length,0);
      await assert.rejects(db.query('select * from uev_list_interviews($1,0,null,$2,$3)',[mod,'','desc']),e=>e.code==='22023');
    });
    await t.test('outbox lease excludes second worker and retries; sent ID persisted',async()=>{
      const claim=(await db.query('select * from uev_claim_notifications()')).rows[0];assert.equal(claim.attempts,1);
      assert.equal((await db.query('select * from uev_claim_notifications()')).rows.length,0);
      await assert.rejects(db.query('select uev_finish_notification($1,$2,$3,null,false)',[claim.id,mod,'provider']),e=>e.code==='40001');
      await db.query('select uev_finish_notification($1,$2,$3,null,false)',[claim.id,claim.lease_token,'provider']);
      const row=(await db.query('select * from notification_outbox')).rows[0];assert.equal(row.status,'sent');assert.equal(row.provider_id,'provider');
    });
    await t.test('notification failure retains request and schedules bounded retry',async()=>{
      await db.exec('reset role');
      await db.query("update notification_outbox set status='pending',attempts=0,first_attempt_at=null,next_attempt_at=now(),sent_at=null,provider_id=null");
      await db.exec('set role service_role');
      const claim=(await db.query('select * from uev_claim_notifications()')).rows[0];
      await db.query('select uev_finish_notification($1,$2,null,$3,true)',[claim.id,claim.lease_token,'MAIL_NETWORK']);
      const pending=(await db.query('select * from notification_outbox')).rows[0];
      assert.equal(pending.status,'pending');assert.equal(pending.attempts,1);assert.ok(pending.next_attempt_at > pending.created_at);
      assert.equal((await db.query('select * from interview_requests')).rows.length,1);
      await db.exec('reset role');await db.query("update notification_outbox set attempts=6, next_attempt_at=now()");await db.exec('set role service_role');
      assert.equal((await db.query('select * from uev_claim_notifications()')).rows.length,0);
      assert.equal((await db.query('select status from notification_outbox')).rows[0].status,'failed');
    });
    await t.test('technical cleanup cannot delete real requests or recent probes',async()=>{
      await db.query("insert into database_health_checks values(gen_random_uuid(),gen_random_uuid(),'old',now()-interval '49 hours'),(gen_random_uuid(),gen_random_uuid(),'recent',now())");
      await db.query('select uev_cleanup_technical()');
      assert.equal((await db.query('select * from database_health_checks')).rows.length,1);
      assert.equal((await db.query('select * from interview_requests')).rows.length,1);
      assert.equal((await db.query('select * from notification_outbox')).rows.length,1);
    });
    await t.test('soft delete and restore retain data, increment revisions and audit atomically', async () => {
      const exported=(await db.query('select uev_export_interview($1,$2) result',[admin,id])).rows[0].result;
      assert.equal(exported.email,payload.email);assert.equal(exported.submission_key_hash,undefined);
      for (const actor of [mod, admin]) await assert.rejects(db.query('select uev_delete_interview($1,$2,4)',[actor,id]),e=>e.code==='42501');
      await assert.rejects(db.query('select uev_trash_interview($1,$2,null)',[admin,id]),e=>e.code==='22023');
      await assert.rejects(db.query('select uev_trash_interview($1,$2,1)',[admin,id]),e=>e.code==='40001');
      await db.query('select uev_trash_interview($1,$2,4)',[admin,id]);
      const row=(await db.query('select * from interview_requests where id=$1',[id])).rows[0];
      assert.equal(row.email,payload.email);assert.ok(row.deleted_at);assert.equal(row.deleted_by,admin);assert.equal(row.revision,5);
      assert.equal((await db.query("select * from uev_list_interviews($1,1,null,'','desc')",[mod])).rows.length,0);
      assert.equal((await db.query("select * from uev_list_interview_trash($1,1,null,'','desc')",[admin])).rows.length,1);
      await assert.rejects(db.query("select * from uev_list_interview_trash($1,1,null,'','desc')",[mod]),e=>e.code==='42501');
      await assert.rejects(db.query('select uev_review_interview($1,$2,5,$3,$4)',[mod,id,'in_review','changed']),e=>e.code==='P0002');
      await assert.rejects(db.query('select uev_export_interview($1,$2)',[admin,id]),e=>e.code==='P0002');
      await assert.rejects(db.query('select uev_restore_interview($1,$2,5)',[mod,id]),e=>e.code==='42501');
      await assert.rejects(db.query('select uev_restore_interview($1,$2,4)',[admin,id]),e=>e.code==='40001');
      await db.query('select uev_cleanup_technical()');
      assert.equal((await db.query('select * from interview_requests')).rows.length,1);
      await db.query('select uev_restore_interview($1,$2,5)',[admin,id]);
      const restored=(await db.query('select * from interview_requests')).rows[0];
      assert.equal(restored.deleted_at,null);assert.equal(restored.deleted_by,null);assert.equal(restored.revision,6);assert.equal(restored.status,'in_review');
      assert.equal((await db.query("select * from uev_list_interviews($1,1,null,'','desc')",[mod])).rows.length,1);
      assert.equal((await db.query("select * from interview_request_events where event_type in ('trashed','restored')")).rows.length,2);
    });
    await t.test('permanent delete requires additional grant and trash; clears PII and related outbox', async () => {
      await assert.rejects(db.query('select uev_delete_interview($1,$2,6)',[admin,id]),e=>e.code==='42501');
      await db.exec('reset role');
      await db.query('update interview_staff set can_purge=true where user_id=$1',[admin]);
      await assert.rejects(db.query('update interview_staff set can_purge=true where user_id=$1',[mod]),e=>e.code==='23514');
      await db.exec('set role service_role');
      await assert.rejects(db.query('select uev_delete_interview($1,$2,6)',[admin,id]),e=>e.code==='40001');
      await db.query('select uev_trash_interview($1,$2,6)',[admin,id]);
      await assert.rejects(db.query('select uev_delete_interview($1,$2,6)',[admin,id]),e=>e.code==='40001');
      await db.query('select uev_delete_interview($1,$2,7)',[admin,id]);
      assert.equal((await db.query('select * from interview_requests')).rows.length,0);
      assert.equal((await db.query('select * from notification_outbox')).rows.length,0);
      const audit=(await db.query('select * from interview_request_events')).rows;
      assert.ok(audit.every(e=>e.request_id===null));
      assert.equal(audit.filter(e=>e.event_type==='deleted').length,1);
      for (const pii of [payload.email,payload.full_name,payload.topic,payload.motivation,'nota privada',hash,ph,id]) assert.equal(JSON.stringify(audit).includes(pii),false);
    });
    await t.test('new RPCs are server-only; helper and direct writes remain inaccessible',async()=>{
      for (const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`);
        for (const fn of ['uev_trash_interview','uev_restore_interview','uev_delete_interview']) await assert.rejects(db.query(`select ${fn}($1,$2,1)`,[admin,id]),e=>e.code==='42501');
        await assert.rejects(db.query("select * from uev_list_interview_trash($1,1,null,'','desc')",[admin]),e=>e.code==='42501');
      }
      await db.exec('set role service_role');
      await assert.rejects(db.query('select uev_require_staff($1,$2)',[admin,'purge']),e=>e.code==='42501');
      await assert.rejects(db.query('update interview_requests set deleted_at=now(),deleted_by=$1',[admin]),e=>e.code==='42501');
    });
    await t.test('public HTTP handler persists in PostgreSQL and retry confirms one logical request',async()=>{
      process.env.SUBMISSION_HASH_SECRET='local-integration-test-only-at-least-32-characters';
      const adapter={rpc:async(name,args)=>{
        assert.equal(name,'uev_submit_interview');
        return (await db.query('select uev_submit_interview($1,$2,$3) result',[JSON.stringify(args.p_data),args.p_key_hash,args.p_payload_hash])).rows[0].result;
      }};
      const handler=createInterviewHandler({db:adapter,enabled:()=>true,limit:async()=>{},deliver:async()=>{},background:()=>{}});
      const body={...payload,submission_key:randomUUID(),website:''};
      const request=()=>new Request('https://ughs-podcast.vercel.app/api/interview-requests',{method:'POST',headers:{Origin:'https://universityenvivo.com','Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal((await handler.fetch(request())).status,200);assert.equal((await handler.fetch(request())).status,200);
      assert.equal((await db.query('select * from interview_requests')).rows.length,1);
      assert.equal((await db.query('select * from notification_outbox')).rows.length,1);
    });
    await t.test('administrative HTTP to real PostgreSQL: session, permissions, trash, restore, purge and conflict',async()=>{
      const rid=(await db.query('select id from interview_requests')).rows[0].id;
      let actor=mod;
      const adapter={
        call:async(path)=>{
          if (path==='user') return {id:actor,email_confirmed_at:'2026-11-09'};
          if (path.startsWith('interview_staff?')) return (await db.query('select * from interview_staff where user_id=$1 and active',[actor])).rows;
          throw new Error('Unexpected adapter call');
        },
        rpc:async(name,args)=>{
          const params=Object.values(args);
          try { const rows=(await db.query(`select * from ${name}(${params.map((_,i)=>`$${i+1}`).join(',')})`,params)).rows;return name.includes('list_')?rows:null; }
          catch(e) { const mapped={42501:[403,'FORBIDDEN'],40001:[409,'CONFLICT'],P0002:[404,'NOT_FOUND']}[e.code];if(mapped)throw new AppError(...mapped);throw e; }
        }
      };
      const handler=createInterviewAdminHandler({db:adapter,authorize:(r,p,d)=>authorizeStaff(r,p,d),limit:async()=>{}});
      const request=(action='',method='GET',body)=>new Request(`https://ughs-podcast.vercel.app/api/interview-admin?${action}`,{method,headers:{Origin:'https://ughs-podcast.vercel.app','Content-Type':'application/json',cookie:`${STAFF_COOKIE}=local-test-token`},...(body?{body:JSON.stringify(body)}:{})});
      const trash=()=>handler.fetch(request(`id=${rid}`,'DELETE',{revision:1,confirmation:'ELIMINAR'}));
      assert.equal((await trash()).status,403);
      actor=admin;assert.equal((await trash()).status,200);
      assert.equal((await trash()).status,409);
      assert.deepEqual((await (await handler.fetch(request())).json()).rows,[]);
      const deleted=(await (await handler.fetch(request('view=trash'))).json()).rows;
      assert.equal(deleted.length,1);assert.equal(deleted[0].id,rid);
      assert.equal((await handler.fetch(request(`action=restore&id=${rid}`,'POST',{revision:2,confirmation:'RESTAURAR'}))).status,200);
      assert.equal((await (await handler.fetch(request())).json()).rows.length,1);
      assert.equal((await handler.fetch(request(`id=${rid}`,'DELETE',{revision:3,confirmation:'ELIMINAR'}))).status,200);
      assert.equal((await handler.fetch(request(`action=purge&id=${rid}`,'DELETE',{revision:4,confirmation:'ELIMINAR'}))).status,400);
      assert.equal((await handler.fetch(request(`action=purge&id=${rid}`,'DELETE',{revision:4,confirmation:'ELIMINAR PERMANENTEMENTE'}))).status,200);
      assert.equal((await db.query('select * from interview_requests')).rows.length,0);
      assert.equal((await db.query('select * from notification_outbox')).rows.length,0);
    });
    await db.exec(await readFile('supabase/tests/permissions.sql','utf8'));
  } finally { await db.close(); }
});
