import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { previewServer } from '../scripts/dev.mjs';

const server = await previewServer(0), base = `http://127.0.0.1:${server.address().port}`;
const engine = process.env.INTERVIEW_MOTION_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'webkit' ? {} : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
const output = `artifacts/qa/motion${engine === 'webkit' ? '/webkit' : ''}`;
await mkdir(output, { recursive: true });
const report = [], baselineComparisons = [];
const staff = { role: 'admin', can_export: true, can_delete: true };
const rows = Array.from({ length: 6 }, (_, i) => ({
  id: `11111111-1111-4111-8111-11111111111${i}`, full_name: `Persona ${i + 1}`, topic: `Historia ${i + 1}`,
  email: 'example@example.test', motivation: 'Una experiencia escolar de prueba.', school_affiliation: null,
  previous_experience: null, status: 'pending', revision: 1, internal_notes: '',
  consent_version: '2026-11-07.v1', consent_accepted_at: '2026-11-07T13:00:00Z', created_at: '2026-11-07T13:00:00Z'
}));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('[data-interview-transition], .interview-motion-layer') && !document.getAnimations().some(a => {
    const el = a.effect?.target;
    return a.playState === 'running' && el instanceof Element && (el.closest('#interviews, #interview-requests, #health-panel') || el.closest('.interview-motion-layer'));
  }));
}
async function clean(page) {
  await settled(page);
  assert.equal(await page.locator('.interview-motion-source, [data-motion-busy]').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[style]')].some(el => el.style.viewTransitionName && el.style.viewTransitionName !== 'none')), false);
}
async function setup({ width, mode, baseline = false }) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
  const errors = [], state = { health: 'unknown', healthFailure: false, post: 0, posts: [], notices: 0, patch: 0, detailRace: false, logged: true, data: structuredClone(rows) };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Refused to (apply|execute|load).*Content Security Policy/i.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ mode }) => {
    if (mode === 'fallback') document.startViewTransition = undefined;
    window.motionEvidence = { nativeReady: 0, nativeSkipped: 0, animations: 0, maxDuration: 0 };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      window.motionEvidence.animations++;
      window.motionEvidence.maxDuration = Math.max(window.motionEvidence.maxDuration, options?.duration ?? 0);
      return animate.call(this, frames, options);
    };
    if (document.startViewTransition) {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        const transition = start(...args);
        transition.ready.then(() => window.motionEvidence.nativeReady++, () => window.motionEvidence.nativeSkipped++);
        return transition;
      };
    }
  }, { mode });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/site-status') return route.fulfill({ json: { comingSoon: false } });
    if (url.pathname === '/api/session') return route.fulfill({ status: 401, json: { error: { message: 'Cuenta requerida' } } });
    if (url.pathname === '/api/interview-requests') {
      if (request.method() === 'GET') return route.fulfill({ json: { enabled: true } });
      state.post++; state.posts.push(request.postDataJSON()); await pause(220);
      if (state.failSubmission) return route.abort('failed');
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === '/api/database-health') {
      if (request.method() === 'POST') { state.healthPosts = (state.healthPosts ?? 0) + 1; await pause(220); }
      if (state.healthFailure) return route.fulfill({ status: 503, json: { error: { message: 'Error de conexión de prueba.' } } });
      return route.fulfill({ json: { state: state.health, latest: null, lastSuccess: null, nextCheck: null } });
    }
    if (url.pathname === '/api/interview-admin') {
      const action = url.searchParams.get('action'), id = url.searchParams.get('id');
      if (action === 'session') return route.fulfill({ json: { staff: state.logged ? staff : null } });
      if (action === 'logout') { state.logged = false; return route.fulfill({ json: { ok: true } }); }
      if (action === 'outbox') {
        if (request.method() === 'POST') { state.notices++; await pause(220); return route.fulfill({ json: { processed: 3, sent: 2, failed: 1 } }); }
        return route.fulfill({ json: { rows: [{ status: 'failed' }] } });
      }
      if (action === 'audit') return route.fulfill({ json: { events: [{ created_at: rows[0].created_at, event_type: 'reviewed', old_status: 'pending', new_status: 'in_review', notes_changed: true }] } });
      if (request.method() === 'PATCH') {
        state.patch++; await pause(120);
        const row = state.data.find(row => row.id === id); Object.assign(row, request.postDataJSON()); row.revision++;
        return route.fulfill({ json: { row } });
      }
      if (id) { await pause(state.detailRace && id === rows[0].id ? 180 : 20); return route.fulfill({ json: { row: state.data.find(row => row.id === id) } }); }
      const q = url.searchParams.get('q'), status = url.searchParams.get('status'), order = url.searchParams.get('order');
      await pause(q === 'slow' ? 180 : 20);
      let selected = q === 'empty' ? [] : state.data.filter(row => !status || row.status === status);
      if (order === 'asc') selected = [...selected].reverse();
      const pageNumber = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: { rows: selected.slice((pageNumber - 1) * 3, pageNumber * 3), hasMore: pageNumber * 3 < selected.length } });
    }
    if (baseline && process.env.INTERVIEW_MOTION_BASELINE) {
      const path = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin/index.html' : url.pathname;
      try {
        const body = await readFile(`${process.env.INTERVIEW_MOTION_BASELINE}${path}`);
        return route.fulfill({ body, contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'application/javascript' : 'text/html' });
      } catch { /* Unmodified files are served normally. */ }
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/index.html') {
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } });
    }
    return route.continue();
  });
  return { page, state, errors };
}
async function goAdmin(page) {
  await page.goto(`${base}/admin`); await page.locator('#interview-rows tr').first().waitFor(); await page.locator('#health-details').filter({ hasText: 'Última' }).waitFor(); await settled(page);
}
async function search(page, q = '', order = 'desc', status = '') {
  await page.locator('#interview-search').fill(q); await page.locator('#interview-order').selectOption(order); await page.locator('#interview-filter').selectOption(status);
  await page.locator('#interview-search-form').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => !document.getElementById('interview-search-button').disabled);
  await settled(page);
}
try {
  const widths = process.env.INTERVIEW_MOTION_WIDTH ? [Number(process.env.INTERVIEW_MOTION_WIDTH)] : [390, 820, 1440];
  const modes = process.env.INTERVIEW_MOTION_MODE ? [process.env.INTERVIEW_MOTION_MODE] : ['native', 'fallback', 'reduced'];
  for (const width of process.env.INTERVIEW_MOTION_BASELINE_ONLY ? [] : widths) for (const mode of modes) {
    const { page, state, errors } = await setup({ width, mode });
    await goAdmin(page);
    // Actual node identity survives sorting; moving a row also produces FLIP work.
    await page.evaluate(() => { window.originalRow = document.querySelector('#interview-rows tr:nth-child(2)'); });
    await search(page, '', 'asc'); await search(page);
    await page.evaluate(() => { window.originalRow = document.querySelector('#interview-rows tr:nth-child(2)'); });
    state.data[1].status = 'in_review';
    await search(page, '', 'desc', 'in_review');
    assert.equal(await page.evaluate(() => window.originalRow === document.querySelector('#interview-rows tr')), true);
    await search(page);
    await page.locator('#interview-next').click(); await page.waitForFunction(() => document.getElementById('interview-page').textContent === 'Página 2'); await settled(page);
    assert.equal(await page.locator('#interview-rows tr').count(), 3);
    await page.locator('#interview-prev').click(); await page.waitForFunction(() => document.getElementById('interview-page').textContent === 'Página 1'); await settled(page);
    await search(page, 'empty'); assert.equal(await page.locator('#interview-empty').isVisible(), true); await search(page);
    // Two overlapping responses: only the current query may update the layout.
    await page.locator('#interview-search').fill('slow'); await page.locator('#interview-search-form').evaluate(form => form.requestSubmit());
    await page.locator('#interview-search').fill('empty'); await page.locator('#interview-search-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => !document.getElementById('interview-search-button').disabled); await pause(220); await settled(page);
    assert.equal(await page.locator('#interview-rows tr').count(), 0); await search(page);
    // Open/close with keyboard and return focus to the actual source button.
    await page.locator('#interview-rows button').first().focus(); await page.keyboard.press('Enter');
    await page.locator('#interview-detail').waitFor({ state: 'visible' }); await settled(page);
    assert.equal(await page.locator('#interview-detail-title').evaluate(el => el === document.activeElement), true);
    // WebKit's screenshot helper inserts an inline stylesheet. Keep the admin's
    // strict production CSP; capture visual artifacts in Chromium instead.
    if (engine === 'chromium') await page.screenshot({ path: `${output}/admin-${width}-${mode}.png`, fullPage: true });
    await page.locator('#interview-review-status').selectOption('in_review'); await page.locator('#interview-notes').fill('Nota conservada durante el guardado.');
    await page.locator('#interview-save').click(); await page.waitForFunction(() => document.getElementById('interview-admin-status').textContent === 'Cambios guardados.'); await settled(page);
    assert.equal(state.patch, 1); assert.equal(state.data[0].internal_notes, 'Nota conservada durante el guardado.');
    for (const [status, label] of [['approved', 'Aprobada'], ['in_review', 'En revisión'], ['rejected', 'Rechazada'], ['in_review', 'En revisión'], ['pending', 'Pendiente']]) {
      await page.locator('#interview-review-status').selectOption(status); await page.locator('#interview-save').click();
      await page.waitForFunction(() => !document.getElementById('interview-save').disabled); await settled(page);
      assert.equal(await page.locator('#interview-rows tr').first().locator('td').nth(3).textContent(), label);
    }
    await page.locator('#interview-audit-button').click(); await page.locator('#interview-audit').waitFor({ state: 'visible' }); await settled(page);
    await page.locator('#interview-close').click(); await page.locator('#interview-detail').waitFor({ state: 'hidden' }); await settled(page);
    assert.equal(await page.locator('#interview-rows button').first().evaluate(el => el === document.activeElement), true);
    // Detail requests arriving in reverse order cannot reopen an earlier applicant.
    state.detailRace = true;
    await page.locator('#interview-rows').evaluate(tbody => { tbody.children[0].querySelector('button').click(); tbody.children[1].querySelector('button').click(); });
    await page.waitForFunction(() => document.getElementById('interview-detail-title').textContent === 'Historia 2'); await pause(220); await settled(page);
    assert.equal(await page.locator('#interview-detail-title').textContent(), 'Historia 2');
    for (let i = 0; i < 4; i++) {
      await page.locator('#interview-close').click(); await page.locator('#interview-detail').waitFor({ state: 'hidden' });
      await page.locator('#interview-rows button').nth(1).click(); await page.locator('#interview-detail').waitFor({ state: 'visible' });
    }
    await settled(page);
    // Health never becomes operational while a response is pending, or because a
    // read-only connection check succeeded while the server still says unknown.
    for (const health of ['unknown', 'ok', 'failed']) {
      state.health = health;
      await page.locator('#health-check').click();
      assert.equal(await page.locator('#health-state').textContent(), 'Comprobando…');
      assert.equal(await page.locator('#health-check').getAttribute('aria-busy'), 'true');
      await page.waitForFunction(() => !document.getElementById('health-check').disabled); await settled(page);
      assert.equal(await page.locator('#health-state').textContent(), { unknown: 'Estado desconocido', ok: 'Operativa', failed: 'Problemas detectados' }[health]);
    }
    state.healthFailure = true; await page.locator('#health-check').click(); await page.waitForFunction(() => !document.getElementById('health-check').disabled); await settled(page);
    assert.equal(await page.locator('#health-state').textContent(), 'Estado desconocido'); state.healthFailure = false;
    const size = await page.locator('#notification-retry').boundingBox();
    await page.locator('#notification-retry').click(); const busySize = await page.locator('#notification-retry').boundingBox();
    assert.equal(size.width, busySize.width); assert.equal(size.height, busySize.height);
    await page.waitForFunction(() => !document.getElementById('notification-retry').disabled); await settled(page);
    assert.match(await page.locator('#notification-state').textContent(), /procesados: 3; aceptados por el proveedor: 2/);
    await clean(page);
    await page.locator('#interview-close').evaluate(button => button.click()); await page.locator('#interview-detail').waitFor({ state: 'hidden' });
    for (let i = 0; i < 3; i++) {
      await page.locator('#interview-rows button').nth(1).evaluate(button => button.click());
      await page.locator('#interview-detail').waitFor({ state: 'visible' }); await pause(60);
      await page.locator('#interview-close').evaluate(button => button.click()); await page.locator('#interview-detail').waitFor({ state: 'hidden' });
    }
    await page.setViewportSize({ width: width + 1, height: 1000 }); await page.setViewportSize({ width, height: 1000 }); await clean(page);
    const evidence = await page.evaluate(() => window.motionEvidence);
    if (mode === 'native') assert.ok(evidence.nativeReady >= 2, JSON.stringify(evidence));
    if (mode === 'reduced') assert.equal(evidence.animations, 0);
    await page.locator('#staff-logout').click(); await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#interview-detail-data').textContent(), ''); await clean(page);
    assert.deepEqual(errors, []);
    report.push({ surface: 'admin', width, mode, ...evidence }); await page.close();

    const pub = await setup({ width, mode }); const p = pub.page;
    await p.goto(base); await p.locator('#interviews').waitFor({ state: 'visible' });
    await p.locator('#interview-toggle').focus(); await p.keyboard.press('Enter'); await settled(p);
    assert.equal(await p.locator('#interview-full_name').evaluate(el => el === document.activeElement), true);
    // Reverse the expansion before its previous frames finish.
    await p.locator('#interview-toggle').evaluate(button => { for (let i = 0; i < 7; i++) button.click(); });
    assert.equal(await p.locator('#interview-form-shell').isVisible(), false); await settled(p);
    await p.locator('#interview-toggle').click(); await settled(p);
    for (let i = 0; i < 3; i++) {
      await p.locator('#interview-toggle').evaluate(button => button.click()); await pause(60);
      await p.locator('#interview-toggle').evaluate(button => button.click()); await pause(60);
    }
    await settled(p);
    await p.locator('#interview-submit').click(); await settled(p); assert.match(await p.locator('#interview-error-full_name').textContent(), /nombre/);
    await p.locator('#interview-full_name').fill('Persona de prueba'); await p.locator('#interview-email').fill('example@example.test');
    await p.locator('#interview-topic').fill('Historia escolar'); await p.locator('#interview-motivation').fill('Una experiencia escolar que quiero compartir.'); await p.locator('#interview-consent_contact').check();
    pub.state.failSubmission = true; await p.locator('#interview-submit').dblclick(); await p.waitForFunction(() => !document.getElementById('interview-submit').disabled); await settled(p);
    assert.equal(pub.state.post, 1); assert.equal(await p.locator('#interview-success').isVisible(), false);
    pub.state.failSubmission = false;
    const normalSize = await p.locator('#interview-submit').boundingBox(); await p.locator('#interview-submit').click();
    const loadingSize = await p.locator('#interview-submit').boundingBox();
    // Computed CSS width serialization can round by one 1/64px layout unit.
    assert.ok(Math.abs(normalSize.width - loadingSize.width) < .1); assert.ok(Math.abs(normalSize.height - loadingSize.height) < .1);
    assert.equal(await p.locator('#interview-success').isVisible(), false);
    await p.locator('#interview-success').waitFor({ state: 'visible' }); await settled(p);
    assert.equal(pub.state.posts[0].submission_key, pub.state.posts[1].submission_key);
    assert.equal(await p.locator('#interview-success').evaluate(el => el === document.activeElement), true);
    await clean(p); assert.deepEqual(pub.errors, []);
    await p.locator('#interviews').screenshot({ path: `${output}/public-${width}-${mode}.png` });
    const publicEvidence = await p.evaluate(() => window.motionEvidence);
    if (mode === 'reduced') assert.equal(publicEvidence.animations, 0);
    report.push({ surface: 'public', width, mode, ...publicEvidence }); await p.close();
    console.log(`PASS ${width}px ${mode}: filters, identity, pagination, empty, racing responses, details, focus, notes, audit, health, notices, form, retry, success, cleanup`);
  }
  // Optional pixel/geometry comparison with the original files saved before edits.
  if (process.env.INTERVIEW_MOTION_BASELINE) {
    for (const width of [390, 820, 1440]) {
      for (const surface of ['admin', 'detail', 'public', 'closed', 'success']) {
        const captures = [];
        for (const baseline of [true, false]) {
          const { page } = await setup({ width, mode: 'reduced', baseline });
          if (surface === 'admin' || surface === 'detail') {
            await goAdmin(page);
            if (surface === 'detail') { await page.locator('#interview-rows button').first().click(); await page.locator('#interview-detail').waitFor({ state: 'visible' }); await settled(page); }
          } else {
            await page.goto(base); await page.locator('#interviews').waitFor({ state: 'visible' });
            if (surface !== 'closed') await page.locator('#interview-toggle').click();
            if (surface === 'success') {
              await page.locator('#interview-full_name').fill('Persona de prueba'); await page.locator('#interview-email').fill('example@example.test');
              await page.locator('#interview-topic').fill('Historia escolar'); await page.locator('#interview-motivation').fill('Una experiencia escolar que quiero compartir.'); await page.locator('#interview-consent_contact').check();
              await page.locator('#interview-submit').click(); await page.locator('#interview-success').waitFor({ state: 'visible' });
            }
            await settled(page);
          }
          await page.mouse.move(0, 0); await settled(page);
          const selector = surface === 'admin' || surface === 'detail' ? '#interview-requests, #health-panel' : '#interviews';
          const geometry = await page.locator(selector).evaluateAll(roots => roots.flatMap(root => [root, ...root.querySelectorAll('*')]).map(el => {
            const box = el.getBoundingClientRect(), css = getComputedStyle(el);
            return { tag: el.tagName, id: el.id, text: el.children.length ? '' : el.textContent, x: box.x, y: box.y, w: box.width, h: box.height, color: css.color, background: css.background, font: css.font, padding: css.padding, margin: css.margin, border: css.border, radius: css.borderRadius };
          }));
          // Both panels are captured separately to exclude unrelated scroll animations.
          const screenshots = [];
          for (const [i, locator] of (await page.locator(selector).all()).entries()) {
            const screenshot = await locator.screenshot({ animations: 'disabled' }); screenshots.push(screenshot);
            await writeFile(`${output}/baseline-${surface}-${width}-${baseline ? 'before' : 'after'}-${i}.png`, screenshot);
          }
          captures.push({ geometry, screenshots }); await page.close();
        }
        assert.deepEqual(captures[1].geometry, captures[0].geometry, `${surface} ${width}px resting geometry/styles`);
        captures[0].screenshots.forEach((before, i) => assert.ok(before.equals(captures[1].screenshots[i]), `${surface} ${width}px screenshot ${i} must be pixel identical`));
        console.log(`PASS original vs updated: ${surface} ${width}px identical geometry, colors, typography and screenshot pixels`);
        baselineComparisons.push({ surface, width, geometry: 'identical', pixels: 'identical' });
      }
    }
  }
  await writeFile(`${output}/${process.env.INTERVIEW_MOTION_BASELINE_ONLY ? 'baseline-report' : 'report'}.json`, JSON.stringify({ browser: engine, scenarios: report, restingDesign: baselineComparisons }, null, 2));
  console.log(`${report.length} motion scenario groups passed, with isolated API fixtures; no external service was called.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
