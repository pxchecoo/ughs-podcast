import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { previewServer } from '../scripts/dev.mjs';
const server = await previewServer(0), base = `http://127.0.0.1:${server.address().port}`;
const engine = process.env.INTERVIEW_MOTION_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless:true, ...(engine === 'chromium' && process.platform === 'darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {}) });
await mkdir('artifacts/qa/contact', {recursive:true});
const row = {id:'11111111-1111-4111-8111-111111111111',full_name:'Persona de prueba',email:'example@example.test',phone_number:'+17875550123',preferred_contact_method:'phone',topic:'Historia escolar',motivation:'Una experiencia escolar de prueba.',previous_experience:null,consent_version:'2026-11-07.v1',revision:1,status:'pending'};
try {
  for (const width of [390,1440]) for (const reducedMotion of ['reduce','no-preference']) {
    const page = await browser.newPage({viewport:{width,height:1000},reducedMotion});
    const errors = [], posts = []; let legacy = false, failed = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.copied=[]; Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.clipboardFails) throw new Error('denied');window.copied.push(value);}}}); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if(url.origin !== base) return route.abort();
      if(url.pathname === '/api/site-status') return route.fulfill({json:{comingSoon:false}});
      if(url.pathname === '/api/session') return route.fulfill({status:401,json:{}});
      if(url.pathname === '/api/database-health') return route.fulfill({json:{state:'unknown'}});
      if(url.pathname === '/api/interview-requests') {
        if(route.request().method() === 'GET') return route.fulfill({json:{enabled:true}});
        posts.push(route.request().postDataJSON());
        if (!failed) { failed=true; return route.abort('failed'); }
        return route.fulfill({json:{ok:true}});
      }
      if(url.pathname === '/api/interview-admin') {
        if(url.searchParams.get('action') === 'session') return route.fulfill({json:{staff:{role:'admin',can_export:true,can_delete:true}}});
        if(url.searchParams.get('id')) return route.fulfill({json:{row:legacy?{...row,phone_number:null,preferred_contact_method:null}:row}});
        return route.fulfill({json:{rows:url.searchParams.get('action') === 'outbox'?[]:[row],hasMore:false}});
      }
      return route.continue();
    });
    await page.goto(base); await page.locator('#interview-toggle').click();
    const phone = page.locator('#interview-phone_number');
    assert.equal(await phone.inputValue(),'+1 ');
    await page.locator('#interview-full_name').fill(row.full_name); await page.locator('#interview-email').fill(row.email);
    await page.locator('#interview-topic').fill(row.topic); await page.locator('#interview-motivation').fill(row.motivation); await page.locator('#interview-consent_contact').check();
    await page.locator('#interview-submit').click();
    assert.match(await page.locator('[data-error=preferred_contact_method]').textContent(),/Selecciona/); assert.equal(posts.length,0);
    assert.equal(await page.locator('[name=preferred_contact_method][value=phone]').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Space'); assert.equal(await phone.getAttribute('required'),'');
    await page.locator('#interview-submit').click(); assert.match(await page.locator('[data-error=phone_number]').textContent(),/teléfono/);
    await phone.fill('123'); await page.locator('#interview-submit').click(); assert.match(await page.locator('[data-error=phone_number]').textContent(),/válido/);
    await page.locator('[name=preferred_contact_method][value=email]').check(); assert.equal(await phone.getAttribute('required'),null);
    await phone.fill(''); await page.locator('#interview-submit').click();
    await page.waitForFunction(()=>document.getElementById('interview-submit').textContent==='Reintentar envío');
    assert.equal(await page.locator('[name=preferred_contact_method][value=email]').isChecked(),true);
    await page.locator('#interview-submit').click(); await page.locator('#interview-success').waitFor({state:'visible'});
    assert.equal(posts.length,2); assert.deepEqual(posts[0],posts[1]); assert.equal(posts[0].preferred_contact_method,'email');
    await page.goto(base); await page.locator('#interview-toggle').click();
    await phone.fill('+1 (787) 555-0123'); await page.locator('[name=preferred_contact_method][value=phone]').check();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#interviews').screenshot({path:`artifacts/qa/contact/${engine}-${width}-${reducedMotion}.png`});
    await page.goto(`${base}/admin/`); await page.locator('#interview-rows button').click(); await page.locator('#interview-detail').waitFor({state:'visible'});
    assert.match(await page.locator('#interview-detail-data').textContent(),/\+17875550123.*Contacto preferidoLlamada telefónica/);
    assert.equal(await page.locator('#interview-call').getAttribute('href'),'tel:+17875550123');
    assert.match(await page.locator('#interview-contact').getAttribute('href'),/^mailto:example%40example.test/);
    await page.locator('#interview-copy-phone').click(); await page.locator('#interview-copy-email').click();
    assert.deepEqual(await page.evaluate(()=>window.copied),[row.phone_number,row.email]);
    await page.evaluate(()=>window.clipboardFails=true); await page.locator('#interview-copy-phone').click();
    await page.waitForFunction(()=>document.getElementById('interview-admin-status').textContent.includes('manualmente'));
    await page.locator('#interview-close').click(); legacy=true;
    await page.locator('#interview-rows button').click();
    await page.waitForFunction(()=>document.getElementById('interview-detail-data').textContent.includes('No especificado'));
    assert.equal((await page.locator('#interview-detail-data').textContent()).match(/No especificado/g).length,2);
    assert.equal(await page.locator('#interview-call').isVisible(),false); assert.equal(await page.locator('#interview-copy-phone').isVisible(),false);
    assert.equal(await page.locator('#interview-copy-email').isVisible(),true); assert.deepEqual(errors,[]);
    console.log(`PASS ${engine} ${width}px ${reducedMotion}: validations, retry, admin, legacy, copy and links`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
