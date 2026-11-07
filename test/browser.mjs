import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { previewServer } from '../scripts/dev.mjs';
const server=await previewServer(0), base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : process.platform==='darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
await mkdir('artifacts/qa',{recursive:true});
const results=[];
const record=name=>{results.push(name);console.log(`PASS ${name}`);};
try {
  for(const [name,width,height] of [['mobile',390,844],['tablet',820,1180],['desktop',1440,1000]]) {
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));let posts=[];let fail=true;
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==base)return route.abort();
      if(url.pathname==='/api/site-status')return route.fulfill({json:{comingSoon:false}});
      if(url.pathname==='/api/interview-requests'){
        if(route.request().method()==='GET')return route.fulfill({json:{enabled:true}});
        posts.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,150));
        return fail ? route.abort('failed') : route.fulfill({json:{ok:true}});
      }
      return route.continue();
    });
    await page.goto(base);await page.locator('#interviews').waitFor({state:'visible'});
    assert.equal(await page.locator('#publicSite').isVisible(),true);assert.equal(await page.locator('#comingSoon').isVisible(),false);
    await page.locator('#interview-toggle').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#interview-full_name').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator('#interview-form-shell').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.locator('#interview-submit').click();assert.match(await page.locator('#interview-error-full_name').textContent(),/nombre/);
    await page.locator('#interview-full_name').fill('Persona de prueba');await page.locator('#interview-email').fill('invalid');await page.locator('#interview-topic').fill('Historia escolar');await page.locator('#interview-motivation').fill('Quiero compartir una experiencia escolar.');
    await page.locator('#interview-submit').click();assert.match(await page.locator('#interview-error-email').textContent(),/correo/);assert.match(await page.locator('#interview-error-consent_contact').textContent(),/consentimiento/);
    await page.locator('#interview-email').fill('example@example.test');await page.locator('#interview-consent_contact').check();
    await page.locator('#interviews').screenshot({path:`artifacts/qa/form-${name}.png`});
    await page.locator('#interview-submit').dblclick();await page.waitForFunction(()=>document.getElementById('interview-submit').disabled===false);
    assert.equal(posts.length,1);assert.equal(await page.locator('#interview-full_name').inputValue(),'Persona de prueba');assert.equal(await page.locator('#interview-success').isVisible(),false);
    fail=false;await page.locator('#interview-submit').click();await page.locator('#interview-success').waitFor({state:'visible'});assert.equal(posts[0].submission_key,posts[1].submission_key);
    assert.equal(await page.locator('#interview-success').evaluate(el=>el===document.activeElement),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} horizontal overflow`);
    assert.deepEqual(errors,[]);await page.screenshot({path:`artifacts/qa/public-${name}.png`,fullPage:true});
    record(`${name}: labels, errors, consent, focus, reduced motion, double click, retry, persistence confirmation, layout`);
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:1440,height:1000}});let logged=false,notes='',revision=1;
  const row={id:'11111111-1111-4111-8111-111111111111',full_name:'Persona de prueba',email:'example@example.test',topic:'<img src=x onerror=alert(1)>',motivation:'Una experiencia de prueba.',school_affiliation:null,previous_experience:null,status:'pending',revision,consent_version:'2026-11-07.v1',consent_accepted_at:'2026-11-07T13:00:00Z',created_at:'2026-11-07T13:00:00Z',internal_notes:notes};
  const staff={user_id:'22222222-2222-4222-8222-222222222222',role:'moderator',can_export:false,can_delete:false};
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/session')return route.fulfill({status:401,json:{error:{message:'Cuenta requerida'}}});
    if(url.pathname==='/api/interview-admin'){
      const action=url.searchParams.get('action');
      if(action==='login'){logged=true;return route.fulfill({json:{staff}});}
      if(action==='session')return route.fulfill(logged?{json:{staff}}:{status:401,json:{error:{message:'Cuenta requerida'}}});
      if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();notes=body.internal_notes;revision++;return route.fulfill({json:{row:{...row,internal_notes:notes,revision,status:body.status}}});}
      if(url.searchParams.get('id'))return route.fulfill({json:{row:{...row,internal_notes:notes,revision}}});
      return route.fulfill({json:{rows:[row],hasMore:false}});
    }
    return route.continue();
  });
  await page.goto(`${base}/admin`);await page.locator('#staff-email').fill('staff@example.test');await page.locator('#staff-password').fill('mock-password');await page.locator('#staff-login-button').click();
  await page.locator('#interview-rows button').waitFor({state:'visible'});assert.equal(await page.locator('#legacy-content').isVisible(),false);
  await page.locator('#interview-rows button').click();await page.locator('#interview-detail').waitFor({state:'visible'});
  assert.equal(await page.locator('#interview-detail-title img').count(),0);assert.match(await page.locator('#interview-detail-title').textContent(),/onerror/);
  assert.equal(await page.locator('#interview-export').isVisible(),false);assert.equal(await page.locator('#interview-delete').isVisible(),false);assert.equal(await page.locator('#health-panel').isVisible(),false);
  await page.locator('#interview-review-status').selectOption('in_review');await page.locator('#interview-notes').fill('Nota de prueba local.');await page.locator('#interview-save').click();await page.waitForFunction(()=>document.getElementById('interview-admin-status').textContent.includes('guardados'));assert.equal(notes,'Nota de prueba local.');
  await page.screenshot({path:'artifacts/qa/admin-desktop.png',fullPage:true});
  record('admin: personal login in existing panel, literal untrusted text, role-aware actions, notes and update');
  for(const width of [390,820]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`artifacts/qa/admin-${width}.png`,fullPage:true});}
  await page.locator('#staff-logout').click();await page.locator('#login-view').waitFor({state:'visible'});assert.equal(await page.locator('#interview-notes').inputValue(),'');assert.equal(await page.locator('#interview-detail-data').textContent(),'');
  record('admin: logout clears applicant details and notes from the DOM');
  await page.close();
  const adminPage=await browser.newPage({viewport:{width:820,height:1180}});let checks=0;
  const adminStaff={...staff,role:'admin',can_export:true,can_delete:true};
  await adminPage.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/session')return route.fulfill({status:401,json:{error:{message:'Cuenta requerida'}}});
    if(url.pathname==='/api/interview-admin'){
      if(url.searchParams.get('action')==='session')return route.fulfill({json:{staff:adminStaff}});
      return route.fulfill({json:{rows:[],hasMore:false}});
    }
    if(url.pathname==='/api/database-health'){
      if(route.request().method()==='POST')checks++;
      return route.fulfill({json:{state:'unknown',latest:null,lastSuccess:null,nextCheck:null,latestProbe:checks?{mode:'connectivity',status:'ok',finished_at:'2026-11-07T13:00:00Z'}:null}});
    }
    return route.continue();
  });
  await adminPage.goto(`${base}/admin`);await adminPage.locator('#health-panel').waitFor({state:'visible'});
  assert.equal(await adminPage.locator('#interview-empty-title').textContent(),'Todavía no tenemos solicitudes.');
  assert.equal(await adminPage.locator('#health-state').textContent(),'Estado desconocido');
  await adminPage.locator('#health-check').click();await adminPage.waitForFunction(()=>!document.getElementById('health-check').disabled);assert.equal(checks,1);assert.match(await adminPage.locator('#health-details').textContent(),/conexión correcta/);assert.equal(await adminPage.locator('#health-state').textContent(),'Estado desconocido');
  await adminPage.locator('#interview-search').fill('Sin resultados');await adminPage.locator('#interview-search-button').click();await adminPage.waitForFunction(()=>document.getElementById('interview-empty-title').textContent.includes('filtros'));
  await adminPage.evaluate(()=>scrollTo(0,0));await adminPage.screenshot({path:'artifacts/qa/admin-health-tablet.png',fullPage:true});
  record('admin: account restore, true empty state, no search results, manual health and unknown state after read-only success');await adminPage.close();
  for(const enabled of [false,true]){
    const page=await browser.newPage();await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base)return route.abort();if(url.pathname==='/api/site-status')return route.fulfill({json:{comingSoon:enabled}});if(url.pathname==='/api/interview-requests')return route.fulfill({json:{enabled:false}});return route.continue();});
    await page.goto(base);await page.waitForFunction(()=>!document.documentElement.classList.contains('site-status-pending'));
    assert.equal(await page.locator('#comingSoon').isVisible(),enabled);assert.equal(await page.locator('#publicSite').isVisible(),!enabled);assert.equal(await page.locator('#interviews').isVisible(),false);
    record(`regression: Coming Soon ${enabled?'ON':'OFF'} and interview flag OFF`);await page.close();
  }
  console.log(`${results.length} browser scenario groups passed; all API responses were local mocks.`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
