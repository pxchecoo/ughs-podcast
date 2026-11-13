import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateSubmission, CONSENT_VERSION } from '../lib/interview-validation.js';
import { AppError, authorizeStaff, STAFF_COOKIE, createDatabase, readJSON, formEnabled } from '../lib/interview-server.js';
import { createInterviewHandler } from '../api/interview-requests.js';
import { createInterviewAdminHandler } from '../api/interview-admin.js';
import { createHealthHandler } from '../api/database-health.js';
import { createMaintenanceHandler } from '../api/interview-maintenance.js';
import { deliverNotifications, sendMail } from '../lib/interview-mail.js';
process.env.SUBMISSION_HASH_SECRET='test-only-secret-never-used-outside-tests-32';
process.env.ADMIN_URL='https://admin.example.test';process.env.RESEND_API_KEY='test-mock-only';process.env.NOTIFICATION_EMAIL_FROM='notices@example.test';process.env.NOTIFICATION_EMAIL_TO='team@example.test';
const valid=()=>({full_name:'  Persona de prueba  ',email:'USER@EXAMPLE.TEST',phone_number:'',preferred_contact_method:'email',school_affiliation:'',topic:'Historia escolar',motivation:'Quiero compartir mi experiencia.',previous_experience:null,consent_contact:true,consent_version:CONSENT_VERSION,submission_key:randomUUID(),website:''});
const origin='https://ughs-podcast.vercel.app';
function req(path='/api/interview-requests', method='POST', data=valid(), extra={}) { return new Request(`${origin}${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',...extra},...(!['GET','OPTIONS'].includes(method)?{body:JSON.stringify(data)}:{})}); }
const noLimit=async()=>{};
const deny=async()=>{throw new AppError(401,'UNAUTHORIZED');};
test('shared validator normalizes data and requires email, limits, consent, explicit fields',()=>{
  const result=validateSubmission(valid());assert.equal(result.valid,true);assert.equal(result.data.email,'user@example.test');assert.equal(result.data.full_name,'Persona de prueba');
  for(const bad of [{full_name:''},{email:'bad'},{topic:'x'.repeat(181)},{motivation:'short'},{consent_contact:false},{consent_version:'old'},{previous_experience:'yes'},{status:'approved'},{internal_notes:'injected'},{submission_key:'bad'}])assert.equal(validateSubmission({...valid(),...bad}).valid,false,JSON.stringify(bad));
});
test('public success only after commit and queues sanitized mail; no applicant identifiers returned',async()=>{
  const order=[];let stored;
  const handler=createInterviewHandler({enabled:()=>true,limit:noLimit,db:{rpc:async(name,args)=>{order.push('commit');stored=args;return randomUUID();}},deliver:async()=>{order.push('mail');},background:()=>{}});
  const response=await handler.fetch(req());assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.deepEqual(order,['commit','mail']);assert.equal(stored.p_key_hash.length,64);assert.equal(stored.p_data.status,undefined);
});
test('commit failure does not claim success or send email; provider failure does not undo success',async()=>{
  let mailed=false;
  const failed=createInterviewHandler({enabled:()=>true,limit:noLimit,db:{rpc:async()=>{throw new Error('secret provider error');}},deliver:async()=>{mailed=true;}});
  const response=await failed.fetch(req());assert.equal(response.status,503);assert.equal(mailed,false);assert.equal((await response.text()).includes('secret provider'),false);
  const good=createInterviewHandler({enabled:()=>true,limit:noLimit,db:{rpc:async()=>randomUUID()},deliver:async()=>{throw new Error('provider down');},background:()=>{}});
  assert.equal((await good.fetch(req())).status,200);
});
test('public endpoint rejects injected admin fields, honeypot, missing origin, huge payload, rate limit and feature disabled',async()=>{
  let called=false;const options={enabled:()=>true,limit:noLimit,db:{rpc:async()=>{called=true;}}};
  for(const [body,expected] of [[{...valid(),status:'approved'},400],[{...valid(),website:'bot'},400],[{...valid(),motivation:'x'.repeat(20000)},413]]) assert.equal((await createInterviewHandler(options).fetch(req(undefined,'POST',body))).status,expected);
  const untrusted=req();untrusted.headers.delete('Origin');assert.equal((await createInterviewHandler(options).fetch(untrusted)).status,403);
  assert.equal((await createInterviewHandler({...options,enabled:()=>false}).fetch(req())).status,503);
  assert.equal((await createInterviewHandler({...options,limit:async()=>{throw new AppError(429,'RATE_LIMITED');}}).fetch(req())).status,429);assert.equal(called,false);
});
test('streamed bodies enforce size even without Content-Length',async()=>{
  await assert.rejects(readJSON(new Request(origin,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(100)})}),20),e=>e.status===413);
});
test('staff authorization verifies remote user and DB allowlist, denies shared cookie, anonymous and unconfirmed',async()=>{
  await assert.rejects(authorizeStaff(req('/api/interview-admin','GET')),e=>e.status===401);
  const request=req('/api/interview-admin','GET',null,{cookie:`${STAFF_COOKIE}=test-jwt`});
  for(const user of [{id:randomUUID(),email_confirmed_at:null},{id:randomUUID(),email_confirmed_at:'today',is_anonymous:true}]) await assert.rejects(authorizeStaff(request,'review',{call:async()=>user}),e=>e.status===401);
  let calls=0;const staff={user_id:randomUUID(),role:'moderator',can_export:false,can_delete:false};const db={call:async()=>++calls%2?{id:staff.user_id,email_confirmed_at:'today'}:[staff]};
  assert.equal((await authorizeStaff(request,'review',db)).role,'moderator');
  for(const permission of ['admin','export','delete']) await assert.rejects(authorizeStaff(request,permission,db),e=>e.status===403);
});
test('administrative endpoints deny unauthorized sessions before DB queries',async()=>{
  let dbCalled=false;const handler=createInterviewAdminHandler({authorize:deny,limit:noLimit,db:{call:async()=>{dbCalled=true;}}});
  for(const method of ['GET','PATCH','DELETE']) assert.equal((await handler.fetch(req('/api/interview-admin',method))).status,401);
  assert.equal((await createHealthHandler({authorize:deny}).fetch(req('/api/database-health','POST'))).status,401);assert.equal(dbCalled,false);
});
test('staff API roles are requested per action; arbitrary columns and revision values denied',async()=>{
  const seen=[];const staff={user_id:randomUUID(),role:'admin'};
  const handler=createInterviewAdminHandler({authorize:async(_r,permission)=>{seen.push(permission);return staff;},limit:noLimit,db:{call:async()=>[],rpc:async()=>[]}});
  const id=randomUUID();
  await handler.fetch(req(`/api/interview-admin?action=export&id=${id}`,'POST',{confirm:true}));
  await handler.fetch(req(`/api/interview-admin?id=${id}`,'DELETE',{revision:1,confirmation:'ELIMINAR'}));
  await handler.fetch(req(`/api/interview-admin?action=audit&id=${id}`,'GET'));
  assert.deepEqual(seen,['export','delete','admin']);
  assert.equal((await handler.fetch(req(`/api/interview-admin?id=${id}`,'PATCH',{revision:1,status:'in_review',internal_notes:'ok',reviewed_by:randomUUID()}))).status,400);
  assert.equal((await handler.fetch(req('/api/interview-admin?page=500','GET'))).status,400);
});
test('personal login issues HttpOnly Secure cookie without exposing JWT or refresh token',async()=>{
  const handler=createInterviewAdminHandler({limit:noLimit,authorize:async()=>({role:'moderator'}),db:{call:async()=>({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600})}});
  const response=await handler.fetch(req('/api/interview-admin?action=login','POST',{email:'staff@example.test',password:'test'}));
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);assert.equal((await response.text()).includes('test-access-token'),false);
});
test('cron rejects missing/wrong secret, disabled environment and supports protected invocation',async()=>{
  let count=0;const environment={CRON_SECRET:'test-cron-secret-at-least-32-characters',INTERVIEW_MAINTENANCE_ENABLED:'true',VERCEL_ENV:'production'};
  const handler=createMaintenanceHandler({environment,run:async()=>{count++;return {status:'ok'};},deliver:async()=>({sent:0,failed:0}),db:{call:async()=>[]}});
  for(const authorization of ['', 'Bearer wrong']) assert.equal((await handler.fetch(req('/api/interview-maintenance','GET',null,{authorization}))).status,401);
  const auth={authorization:`Bearer ${environment.CRON_SECRET}`};assert.equal((await handler.fetch(req('/api/interview-maintenance','GET',null,auth))).status,200);assert.equal(count,1);
  environment.VERCEL_ENV='preview';assert.equal((await handler.fetch(req('/api/interview-maintenance','GET',null,auth))).status,503);
});
test('Supabase adapter uses server-only modern secret key, bounded calls and maps conflicts safely',async()=>{
  let options;const db=createDatabase({environment:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'},fetcher:async(_url,opts)=>{options=opts;return new Response(JSON.stringify({code:'40001',message:'SQL and secret'}),{status:409});}});
  await assert.rejects(db.rpc('uev_review_interview',{}),e=>e.code==='CONFLICT' && !e.message.includes('SQL'));
  assert.equal(options.headers.apikey,'sb_secret_test');assert.equal(options.headers.Authorization,undefined);assert.ok(options.signal);
});
test('outbox sends no PII, passes stable provider idempotency and records failed attempts for retry',async()=>{
  const calls=[],mails=[];const row={id:randomUUID(),lease_token:randomUUID()};
  const db={rpc:async(name,args)=>{calls.push({name,args});return name==='uev_claim_notifications'?[row]:null;}};
  const result=await deliverNotifications(null,{db,send:async mail=>{mails.push(mail);return 'provider-id';}});
  assert.equal(result.sent,1);assert.match(mails[0].key,new RegExp(row.id));assert.equal(calls[1].args.p_provider_id,'provider-id');assert.equal(mails[0].text.includes('Persona'),false);
  calls.length=0;
  await deliverNotifications(null,{db,send:async()=>{const e=new Error('raw provider secret');e.code='MAIL_NETWORK';e.retry=true;throw e;}});
  assert.equal(calls[1].args.p_error,'MAIL_NETWORK');assert.equal(calls[1].args.p_retry,true);
});
test('mail transport uses configured recipients, idempotency, plain text and bounded timeout',async()=>{
  let sent;const id=await sendMail({subject:'subject',text:'technical only',key:'test/key'},{fetcher:async(url,opts)=>{sent={url,...opts};return new Response('{"id":"test-provider-id"}');}});
  assert.equal(id,'test-provider-id');assert.equal(sent.headers['Idempotency-Key'],'test/key');assert.ok(sent.signal);assert.equal(JSON.parse(sent.body).text,'technical only');
});
test('feature remains disabled unless explicitly configured',()=>{assert.equal(formEnabled(),false);});

test('trash/restore/purge API validates confirmations, IDs and binds server actor', async () => {
  const calls=[],permissions=[],actor=randomUUID(),id=randomUUID();
  const handler=createInterviewAdminHandler({limit:noLimit,authorize:async(_r,p)=>{permissions.push(p);return {user_id:actor};},db:{rpc:async(name,args)=>{calls.push({name,args});return [];},call:async path=>{calls.push({path});return [];}}});
  for (const [action,method,confirmation,name] of [['','DELETE','ELIMINAR','uev_trash_interview'],['restore','POST','RESTAURAR','uev_restore_interview'],['purge','DELETE','ELIMINAR PERMANENTEMENTE','uev_delete_interview']]) {
    const path=`/api/interview-admin?id=${id}${action?`&action=${action}`:''}`;
    assert.equal((await handler.fetch(req(path,method,{revision:2,confirmation}))).status,200);
    assert.deepEqual(calls.at(-1),{name,args:{p_actor:actor,p_id:id,p_revision:2}});
    const count=calls.length;
    for (const body of [{revision:2,confirmation:'wrong'},{revision:0,confirmation},{revision:2,confirmation,p_actor:randomUUID()}]) assert.equal((await handler.fetch(req(path,method,body))).status,400);
    assert.equal((await handler.fetch(req(path.replace(id,'bad'),method,{revision:2,confirmation}))).status,400);
    assert.equal(calls.length,count);
  }
  assert.equal((await handler.fetch(req('/api/interview-admin?view=trash','GET'))).status,200);
  assert.equal(calls.at(-1).name,'uev_list_interview_trash');
  assert.equal(permissions.at(-1),'delete');
  assert.equal((await handler.fetch(req('/api/interview-admin?view=active','GET'))).status,200);
  assert.equal(calls.at(-1).name,'uev_list_interviews');
  assert.equal((await handler.fetch(req(`/api/interview-admin?id=${id}&view=trash`,'GET'))).status,404);
  assert.match(calls.at(-1).path,/deleted_at=not.is.null/);
});

test('real authorization rejects missing delete/purge grants and moderator, including trash reads',async()=>{
  const user_id=randomUUID(),id=randomUUID();let permissionChecks=0,mutations=0;
  const row={user_id,role:'admin',can_delete:false,can_purge:false};
  const db={call:async(path)=>path==='user'?{id:user_id,email_confirmed_at:'today'}:[row],rpc:async()=>{mutations++;}};
  const handler=createInterviewAdminHandler({db,limit:noLimit,authorize:async(r,p)=>{permissionChecks++;return authorizeStaff(r,p,db);}});
  const cookie={cookie:`${STAFF_COOKIE}=test-only-token`};
  for (const role of ['admin','moderator']) {
    row.role=role;
    for (const [path,method,body] of [[`?id=${id}`,'DELETE',{revision:1,confirmation:'ELIMINAR'}],[`?id=${id}&action=restore`,'POST',{revision:1,confirmation:'RESTAURAR'}],[`?id=${id}&action=purge`,'DELETE',{revision:1,confirmation:'ELIMINAR PERMANENTEMENTE'}],['?view=trash','GET',null]]) assert.equal((await handler.fetch(req(`/api/interview-admin${path}`,method,body,cookie))).status,403);
  }
  assert.equal(mutations,0);assert.equal(permissionChecks,8);
  row.role='admin';row.can_delete=true;
  assert.equal((await handler.fetch(req(`/api/interview-admin?id=${id}&action=purge`,'DELETE',{revision:1,confirmation:'ELIMINAR PERMANENTEMENTE'},cookie))).status,403);
  row.can_purge=true;
  assert.equal((await handler.fetch(req(`/api/interview-admin?id=${id}&action=purge`,'DELETE',{revision:1,confirmation:'ELIMINAR PERMANENTEMENTE'},cookie))).status,200);
});

test('contact validation requires choice, phone only for calls, normalizes and validates optional phones', () => {
  for (const method of [undefined, null, '', 'sms', 1]) assert.equal(validateSubmission({...valid(), preferred_contact_method:method}).valid, false);
  for (const phone of ['', '+1 ', null]) {
    assert.equal(validateSubmission({...valid(), phone_number:phone}).valid, true);
    for (const method of ['phone','both']) assert.equal(validateSubmission({...valid(), preferred_contact_method:method, phone_number:phone}).valid, false);
  }
  for (const phone of ['7875550123', '(787) 555-0123', '+1 (787) 555-0123', '17875550123']) {
    const result = validateSubmission({...valid(), preferred_contact_method:'phone', phone_number:phone});
    assert.equal(result.valid, true); assert.equal(result.data.phone_number, '+17875550123');
  }
  assert.equal(validateSubmission({...valid(), phone_number:'+34 612 345 678'}).data.phone_number, '+34612345678');
  for (const phone of ['555', '+1 123 123 1234', '+1 787 555 012', '+1234567890123456', '7875550123 ext 2', '+1+7875550123', {}, 7875550123]) assert.equal(validateSubmission({...valid(), phone_number:phone}).valid, false);
});
test('HTTP rejects missing contact method/phone before persistence and retains both contact fields', async () => {
  let saved;
  const handler = createInterviewHandler({enabled:()=>true, limit:noLimit, db:{rpc:async(_name,args)=>{saved=args.p_data;return randomUUID();}}, deliver:async()=>{}, background:()=>{}});
  for (const patch of [{preferred_contact_method:''}, {preferred_contact_method:'phone',phone_number:''}, {preferred_contact_method:'both',phone_number:''}, {preferred_contact_method:'both',phone_number:'+17875550123',email:''}, {phone_number:'abc'}]) assert.equal((await handler.fetch(req(undefined,'POST',{...valid(),...patch}))).status,400);
  assert.equal(saved, undefined);
  for (const method of ['phone','both']) {
    assert.equal((await handler.fetch(req(undefined,'POST',{...valid(),preferred_contact_method:method,phone_number:'(939) 555-0123'}))).status,200);
    assert.equal(saved.phone_number,'+19395550123'); assert.equal(saved.preferred_contact_method,method); assert.equal(saved.email,'user@example.test');
  }
});
