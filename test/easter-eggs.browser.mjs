import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { previewServer } from '../scripts/dev.mjs';

const server = await previewServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
      if (url.pathname === '/api/site-status') return route.fulfill({ json: { comingSoon: false } });
      if (url.pathname === '/api/interview-requests') return route.fulfill({ json: { enabled: true } });
      return route.fulfill({ status: 401, json: { error: { message: 'Cuenta requerida' } } });
    }
    return route.continue();
  });
  const message = page.getByText('🎉 ¡Haz encontrado el codigo ocultoo!', { exact: true });
  await page.goto(base);
  await page.keyboard.type('university');
  assert.equal(await message.count(), 1);
  assert.equal(await page.locator('div[style*="caerConfeti"]').count(), 120);
  console.log('PASS university: original message and confetti');

  await page.reload();
  await page.keyboard.type('admi');
  assert.equal(page.url(), `${base}/`);
  await page.keyboard.type('xadimxadm');
  assert.equal(page.url(), `${base}/`);
  await page.keyboard.press('Escape');
  await page.keyboard.type('in');
  assert.equal(page.url(), `${base}/`);

  // Exercise real form controls and inherited contenteditable regions.
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'easter-egg-fixture';
    fixture.innerHTML = '<input><textarea></textarea><select><option>Option</option></select><form><button type="button">Form button</button></form><div contenteditable="true"><span tabindex="0">Editable</span></div><div role="textbox" tabindex="0">Textbox</div>';
    document.body.append(fixture);
  });
  for (const selector of ['input', 'textarea', 'select', 'button', '[contenteditable] span', '[role="textbox"]']) {
    await page.locator(`#easter-egg-fixture ${selector}`).focus();
    await page.keyboard.type('adminuniversity');
    assert.equal(page.url(), `${base}/`);
    assert.equal(await message.count(), 0);
  }
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.type('ad');
  await page.locator('#easter-egg-fixture input').focus();
  await page.keyboard.type('x');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.type('min');
  assert.equal(page.url(), `${base}/`);
  console.log('PASS incomplete/interrupted sequences and form/editable exclusions');

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.keyboard.type('adminuniversity');
  assert.equal(page.url(), `${base}/`);
  assert.equal(await message.count(), 0);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.keyboard.type('university');
  assert.equal(await message.count(), 1);
  console.log('PASS listener cleanup and restoration without duplicate activation');

  for (const word of ['admin', 'ADMIN', 'AdMiN']) {
    await page.goto(base);
    await Promise.all([page.waitForURL(`${base}/admin`), page.keyboard.type(word)]);
    await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#staff-password').isVisible(), true);
    assert.equal(await page.locator('#legacy-content').isVisible(), false);
  }
  assert.equal(requests.some(request => !request.startsWith('GET ')), false);
  assert.deepEqual(errors, []);
  console.log('PASS admin in all letter cases: immediate navigation, login required, no login submission');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
