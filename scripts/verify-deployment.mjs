import { chromium } from 'playwright';
import assert from 'node:assert/strict';
// JSON on stdin. Temporary access URLs stay in memory and are never logged or saved.
process.stdout.write('Ready for deployment verification JSON on stdin (input is hidden).\n');
const input=await new Promise(resolve=>{let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{raw+=chunk;if(raw.includes('\n')){process.stdin.pause();resolve(JSON.parse(raw.trim()));}});});
const base=new URL(input.url).origin;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
try {
  const context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();await page.goto(input.shareUrl??base,{waitUntil:'domcontentloaded'});
  const checks=[
    ['/api/interview-requests',200,'enabled'],['/api/interview-admin?action=session',401,'UNAUTHORIZED'],
    ['/api/database-health',401,'UNAUTHORIZED'],['/api/interview-maintenance',401,'UNAUTHORIZED'],
    ['/api/session',401,'UNAUTHORIZED'],['/admin',200,'staff-login-form'],['/privacy/',200,'privacidad'],
    ['/lib/interview-validation.js',200,'CONSENT_VERSION'],['/lib/interview-server.js',404],['/.env.local',404],
    ['/supabase/migrations/202611070001_interviews.sql',404]
  ];
  for(const [path,status,contains] of checks){
    const response=await context.request.get(base+path,{maxRedirects:3});console.log(`CHECK ${path}: ${response.status()}`);assert.equal(response.status(),status,`${path} status`);
    const text=await response.text();if(contains)assert.ok(text.toLowerCase().includes(contains.toLowerCase()),`${path} content`);
    console.log(`PASS ${path} ${response.status()}`);
  }
  const configuration=await context.request.get(base+'/api/interview-requests');
  assert.equal((await configuration.json()).enabled,input.enabled===true);console.log('PASS expected public feature state');
  const post=await context.request.post(base+'/api/interview-requests',{headers:{Origin:base},data:{}});
  assert.equal(post.status(),input.enabled===true?400:503);assert.equal((await post.json()).error.code,input.enabled===true?'VALIDATION_FAILED':'FORM_DISABLED');console.log('PASS invalid POST has no persistence path');
  if(input.cronSecret){
    const maintenance=await context.request.get(base+'/api/interview-maintenance',{headers:{Authorization:`Bearer ${input.cronSecret}`},timeout:120000});
    assert.equal(maintenance.status(),200);const result=await maintenance.json();assert.equal(result.ok,true);assert.equal(result.notifications,'processed');console.log('PASS authorized full database health and outbox maintenance');
  }
  const badOrigin=await context.request.post(base+'/api/interview-requests',{headers:{Origin:'https://untrusted.example'},data:{}});assert.equal(badOrigin.status(),403);console.log('PASS mutation rejects untrusted Origin');
  const status=await context.request.get(base+'/api/site-status');assert.equal(status.status(),200);assert.equal(typeof(await status.json()).comingSoon,'boolean');console.log('PASS existing Coming Soon read');
  await context.close();console.log('Deployment verification passed. No applicant records were created or modified.');
} catch { console.error('DEPLOYMENT_VERIFICATION_FAILED. No credentials or raw access URLs are logged.');process.exitCode=1; }
finally {await browser.close();}
