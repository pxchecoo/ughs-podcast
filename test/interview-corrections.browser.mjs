import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { previewServer } from '../scripts/dev.mjs';
const server = await previewServer(0), base = `http://127.0.0.1:${server.address().port}`;
const engine = process.env.INTERVIEW_MOTION_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chromium' && process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
const output = `artifacts/qa/corrections/${engine}`;
await mkdir(output, { recursive: true });
const report = [];
// Synthetic silent WAV: exercises the real media element without external media.
const rate = 8000, bytes = rate * 8 * 2, wav = Buffer.alloc(44 + bytes);
wav.write('RIFF'); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
async function settle(page) {
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.target?.closest?.('#interviews')));
}
try {
  for (const width of [390, 820, 1440]) for (const reduced of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/api/site-status') return route.fulfill({ json: { comingSoon: false } });
      if (url.pathname === '/api/interview-requests') return route.fulfill({ json: { enabled: true } });
      return route.continue();
    });
    await page.goto(base); await page.locator('#interviews').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.dock, #dockTitle, #dockMeta, #dockPlayBtn, #dockProgress').count(), 0);
    assert.equal(await page.locator('.site').evaluate(el => getComputedStyle(el).paddingBottom), '0px');
    assert.equal(await page.locator('#mainIcon svg').count(), 1);
    await page.evaluate(() => { window.playerLinks = []; window.open = url => { window.playerLinks.push(url); return null; }; });
    await page.locator('#heroPlayBtn').click();
    assert.deepEqual(await page.evaluate(() => window.playerLinks), ['https://www.youtube.com']);
    await page.evaluate(async source => {
      const audio = document.getElementById('mainAudio'); audio.src = source; audio.load();
      await new Promise((resolve, reject) => { audio.addEventListener('loadedmetadata', resolve, { once: true }); audio.addEventListener('error', reject, { once: true }); });
      await audio.play();
      await new Promise(resolve => { audio.addEventListener('seeked', resolve, { once: true }); audio.currentTime = 2; });
      audio.dispatchEvent(new Event('timeupdate'));
    }, `data:audio/wav;base64,${wav.toString('base64')}`);
    const media = await page.evaluate(() => ({time: mainAudio.currentTime, duration: mainAudio.duration, progress: document.getElementById('heroProgressFill').style.width}));
    assert.ok(Math.abs(parseFloat(media.progress) - 25) < 1, JSON.stringify(media));
    assert.match(await page.locator('#heroPlayIcon').innerHTML(), /M8 5h3/);
    await page.evaluate(() => document.getElementById('mainAudio').pause());
    assert.match(await page.locator('#heroPlayIcon').innerHTML(), /M8 5.5/);
    await page.locator('.episode-card').nth(1).click();
    assert.equal(await page.locator('#mainTitle').textContent(), await page.locator('.episode-card').nth(1).getAttribute('data-title'));
    assert.equal(await page.locator('#mainIcon svg').count(), 1);
    await page.locator('#interview-toggle').scrollIntoViewIfNeeded(); await page.waitForTimeout(700);
    // Real pointer activation: no field focus and no keyboard-triggering autofocus.
    await page.locator('#interview-toggle').click();
    const samples = await page.evaluate(() => new Promise(resolve => {
      const samples = []; let start;
      function frame(time) {
        start ??= time;
        const shell = document.getElementById('interview-form-shell');
        samples.push({ ms: time - start, scrollY, height: shell.getBoundingClientRect().height, fieldTop: document.getElementById('interview-full_name').getBoundingClientRect().top, ctaVisible: getComputedStyle(document.getElementById('interview-toggle')).visibility, inert: shell.inert, focus: document.activeElement.id });
        if (time - start < 450) requestAnimationFrame(frame); else resolve(samples);
      }
      requestAnimationFrame(frame);
    }));
    await settle(page);
    const spread = key => Math.max(...samples.map(s => s[key])) - Math.min(...samples.map(s => s[key]));
    assert.ok(spread('scrollY') <= 1, `scroll jump ${spread('scrollY')}`);
    assert.ok(spread('fieldTop') <= 1, `field travel ${spread('fieldTop')}`);
    assert.ok(samples.every(s => s.ctaVisible === 'visible' && s.focus !== 'interview-full_name'));
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i].height >= samples[i - 1].height - .1, 'monotonic expansion');
    if (!reduced) { assert.ok(samples[0].height < samples.at(-1).height); assert.ok(samples[0].inert); }
    assert.equal(await page.locator('#interview-form-shell').evaluate(el => el.inert), false);
    await page.locator('#interview-full_name').fill('Datos que sobreviven al cierre');
    // Reverse at a presented intermediate frame; no jump to the committed height.
    await page.locator('#interview-toggle').evaluate(el => el.click()); await page.waitForTimeout(90);
    if (!reduced) {
      const reversal = await page.evaluate(() => {
        const shell = document.getElementById('interview-form-shell'), before = shell.getBoundingClientRect().height;
        document.getElementById('interview-toggle').click(); return { before, after: shell.getBoundingClientRect().height };
      });
      assert.ok(Math.abs(reversal.before - reversal.after) < 1); await settle(page);
      await page.locator('#interview-toggle').evaluate(el => el.click());
    }
    await page.locator('#interview-form-shell').waitFor({ state: 'hidden' });
    await page.locator('#interview-toggle').focus(); await page.keyboard.press('Enter'); await settle(page);
    assert.equal(await page.locator('#interview-full_name').evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator('#interview-full_name').inputValue(), 'Datos que sobreviven al cierre');
    assert.equal(await page.locator('#interview-form-shell').evaluate(el => el.clientHeight >= el.scrollHeight - 1), true);
    if (!reduced) {
      await page.locator('#interview-toggle').evaluate(el => el.click()); await page.waitForTimeout(60);
      await page.setViewportSize({ width: width + 1, height: 900 }); await settle(page);
      await page.locator('#interview-form-shell').waitFor({ state: 'hidden' });
      await page.locator('#interview-toggle').click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await settle(page);
      assert.equal(await page.locator('#interview-form-shell').evaluate(el => el.inert), false);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    if (engine === 'chromium') { await page.locator('#interviews').screenshot({ path: `${output}/form-${width}-${reduced}.png` }); await page.locator('.player-shell').screenshot({ path: `${output}/player-${width}-${reduced}.png` }); }
    report.push({ width, reduced, scrollSpread: spread('scrollY'), fieldSpread: spread('fieldTop'), samples });
    console.log(`PASS ${engine} ${width}px reduced=${reduced}: stable flow, reversal, focus, resize, values, dock removed, hero links and real local audio`);
    await page.close();
  }
  await writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
