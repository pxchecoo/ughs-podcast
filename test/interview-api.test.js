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
const valid=()=>({full_name:'  Persona de prueba  ',email:'USER@EXAMPLE.TEST',school_affiliation:'',topic:'Historia escolar',motivation:'Quiero compartir mi experiencia.',previous_experience:null,consent_contact:true,consent_version:CONSENT_VERSION,submission_key:randomUUID(),website:''});
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
