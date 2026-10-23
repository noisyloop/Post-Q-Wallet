#!/usr/bin/env node
/**
 * Drives the production build in Chromium (demo mode) and captures the
 * screenshots + GIFs in docs/media.
 *
 *   npm run build && npm run media
 *
 * Requires ffmpeg on PATH for GIF encoding.
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs/media');
const TMP = join(ROOT, '.media-tmp');
const URL = 'http://localhost:4173/';
const VIEW = { width: 390, height: 844 };
const PASSWORD = 'Rainbow-Phantom-2026!';
const RECIPIENT = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(URL)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('preview server did not start');
};

const launchOpts = existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};

// ---------------- flows ----------------

async function onboarding(page, shot, slow) {
  await page.goto(URL);
  await page.waitForSelector('[data-testid=create-wallet]');
  await sleep(slow ? 1200 : 300);
  await page.click('.toggle-row');
  await shot('01-welcome');
  await sleep(slow ? 600 : 0);
  await page.click('[data-testid=create-wallet]');
  await page.locator('[data-testid=pw1]').pressSequentially(PASSWORD, { delay: slow ? 40 : 0 });
  await page.locator('[data-testid=pw2]').pressSequentially(PASSWORD, { delay: slow ? 25 : 0 });
  await shot('02-create-password');
  await sleep(slow ? 500 : 0);
  await page.click('[data-testid=pw-continue]');
  await page.waitForSelector('[data-testid=phrase-grid]');
  await sleep(slow ? 900 : 200);
  await shot('03-recovery-phrase-hidden');
  await page.click('[data-testid=reveal-phrase]');
  await sleep(slow ? 1400 : 200);
  await page.click('[data-testid=ack-phrase]');
  await sleep(slow ? 500 : 0);
  await page.click('[data-testid=phrase-continue]');
  await page.waitForSelector('.quiz');
  await sleep(slow ? 600 : 100);
  for (const el of await page.$$('[data-testid^=quiz-correct-]')) {
    await el.click();
    await sleep(slow ? 450 : 50);
  }
  await shot('04-verify-phrase');
  await page.click('[data-testid=verify-finish]');
  await page.waitForSelector('[data-testid=token-list] .token-row:not(.skeleton)', { timeout: 30_000 });
  await sleep(slow ? 1500 : 500);
}

async function unlock(page, slow) {
  await page.goto(URL);
  await page.waitForSelector('[data-testid=unlock-pw]');
  await sleep(slow ? 700 : 0);
  await page.locator('[data-testid=unlock-pw]').pressSequentially(PASSWORD, { delay: slow ? 30 : 0 });
  await page.click('[data-testid=unlock-btn]');
  await page.waitForSelector('[data-testid=token-list] .token-row:not(.skeleton)', { timeout: 30_000 });
  await sleep(slow ? 1200 : 400);
}

async function hold(page, slow) {
  await page.locator('[data-testid=hold-button]').scrollIntoViewIfNeeded();
  await sleep(slow ? 400 : 100);
  const box = await page.locator('[data-testid=hold-button]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(1500);
  await page.mouse.up();
  await sleep(slow ? 200 : 0);
}

async function homeTour(page, shot, slow) {
  await shot('05-home');
  await page.click('[data-testid=chip-solana]');
  await sleep(slow ? 1000 : 200);
  await shot('06-home-solana');
  await page.click('.chips .chip >> nth=0');
  await sleep(slow ? 500 : 100);
  await page.click('[data-testid=action-receive]');
  await sleep(slow ? 900 : 400);
  await shot('12-receive-evm');
  await page.click('[data-testid=recv-solana]');
  await sleep(slow ? 900 : 200);
  await page.click('[data-testid=recv-bitcoin]');
  await sleep(slow ? 900 : 200);
  await shot('13-receive-bitcoin');
  await page.keyboard.press('Escape');
  await sleep(slow ? 600 : 200);
}

async function crossChainSwap(page, shot, slow) {
  await page.click('[data-testid=tab-swap]');
  await sleep(slow ? 800 : 200);
  await page.click('[data-testid=swap-from]');
  await sleep(slow ? 700 : 300);
  await page.locator('[data-testid=token-search]').pressSequentially('eth', { delay: slow ? 90 : 0 });
  await sleep(slow ? 500 : 200);
  await shot('07-token-picker');
  await page.click('[data-testid=pick-arbitrum-ETH]');
  await sleep(slow ? 500 : 100);
  await page.click('[data-testid=swap-to]');
  await sleep(slow ? 500 : 200);
  await page.click('[data-testid=pick-solana-SOL]');
  await sleep(slow ? 500 : 100);
  await page.locator('[data-testid=swap-amount]').pressSequentially('0.5', { delay: slow ? 160 : 0 });
  await page.waitForSelector('[data-testid=quote-card]');
  await sleep(slow ? 1800 : 300);
  await shot('08-swap-quote');
  await page.click('[data-testid=swap-review]');
  await page.waitForSelector('[data-testid=safety-checks]');
  await sleep(slow ? 1800 : 400);
  await shot('09-swap-review-safety-checks');
  await hold(page, slow);
  await page.waitForSelector('.pstep.active');
  await sleep(1400);
  await shot('10-swap-bridging');
  await page.waitForSelector('[data-testid=swap-done]', { timeout: 20_000 });
  await sleep(slow ? 2000 : 500);
  await shot('11-swap-complete');
  await page.click('[data-testid=swap-done]');
  await sleep(slow ? 600 : 200);
}

async function send(page, shot, slow) {
  await page.click('[data-testid=tab-home]');
  await sleep(slow ? 600 : 200);
  await page.click('[data-testid=action-send]');
  await sleep(slow ? 500 : 200);
  await page.click('[data-testid=send-token]');
  await sleep(slow ? 600 : 200);
  await page.click('[data-testid=pick-base-USDC]');
  await sleep(slow ? 500 : 100);
  await page.locator('[data-testid=send-to]').pressSequentially(RECIPIENT, { delay: slow ? 18 : 0 });
  await sleep(slow ? 500 : 100);
  await page.locator('[data-testid=send-amount]').pressSequentially('125', { delay: slow ? 150 : 0 });
  await sleep(slow ? 700 : 200);
  await shot('14-send-form');
  await page.click('[data-testid=send-review]');
  await sleep(slow ? 1400 : 300);
  await shot('15-send-review');
  await hold(page, slow);
  await page.waitForSelector('.result-icon.ok', { timeout: 15_000 });
  await sleep(slow ? 1500 : 400);
  await shot('16-send-complete');
  await page.click('text=Done');
  await sleep(slow ? 500 : 200);
}

async function launchToken(page, shot, slow) {
  await page.click('[data-testid=tab-launch]');
  await sleep(slow ? 900 : 300);
  await page.locator('[data-testid=launch-name]').pressSequentially('Post Q Doge', { delay: slow ? 70 : 0 });
  await page.locator('[data-testid=launch-symbol]').pressSequentially('PQDOGE', { delay: slow ? 90 : 0 });
  await sleep(slow ? 500 : 100);
  await page.locator('[data-testid=launch-sol]').fill('');
  await page.locator('[data-testid=launch-sol]').pressSequentially('8', { delay: slow ? 120 : 0 });
  await sleep(slow ? 700 : 200);
  await shot('20-launch-form');
  await page.locator('.tax-box').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('.screen.launch').scrollBy(0, 160));
  await sleep(slow ? 700 : 200);
  for (const k of slow ? ['light', 'max', 'standard'] : ['standard']) {
    await page.click(`[data-testid=tax-${k}]`);
    await sleep(slow ? 900 : 100);
  }
  await shot('21-launch-anti-snipe');
  await page.click('[data-testid=launch-review]');
  await page.waitForSelector('[data-testid=launch-checks]');
  await sleep(slow ? 2200 : 400);
  await shot('22-launch-review');
  await page.click('[data-testid=launch-ack]');
  await sleep(slow ? 500 : 100);
  await hold(page, slow);
  await page.waitForSelector('.pstep.active');
  await sleep(slow ? 1000 : 800);
  await shot('23-launch-progress');
  await page.waitForSelector('[data-testid=launch-done]', { timeout: 20_000 });
  await sleep(slow ? 2500 : 500);
  await shot('24-launch-live');
}

async function settingsAndActivity(page, shot) {
  await page.click('[data-testid=tab-activity]');
  await sleep(400);
  await shot('17-activity');
  await page.click('[data-testid=tab-settings]');
  await sleep(400);
  await shot('18-settings-security');
  await page.click('[data-testid=lock-now]');
  await page.waitForSelector('[data-testid=unlock-pw]');
  await sleep(600);
  await shot('19-unlock');
}

// ---------------- runners ----------------

async function screenshots(browser) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const shot = async (name) => {
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log('  📸', name);
  };
  await onboarding(page, shot, false);
  await homeTour(page, shot, false);
  await crossChainSwap(page, shot, false);
  await send(page, shot, false);
  await launchToken(page, shot, false);
  await page.click('text=Done');
  await sleep(300);
  await settingsAndActivity(page, shot);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

async function recordGif(browser, name, storageState, flow) {
  const dir = join(TMP, name);
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: 'dark', storageState, recordVideo: { dir, size: VIEW } });
  const page = await ctx.newPage();
  await flow(page);
  await sleep(600);
  await ctx.close();
  const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
  const gif = join(OUT, `${name}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm,
    '-vf', 'fps=14,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', gif]);
  renameSync(webm, join(TMP, `${name}.webm`));
  console.log('  🎞 ', name);
}

const noShot = async () => {};

try {
  await waitForServer();
  const browser = await chromium.launch(launchOpts);
  console.log('Screenshots');
  const state = await screenshots(browser);
  // Activity from the screenshot run would leak into the GIFs; keep only the vault.
  state.origins.forEach((o) => { o.localStorage = o.localStorage.filter((kv) => kv.name !== 'pqw.activity' && kv.name !== 'pqw.launches'); });

  console.log('GIFs');
  await recordGif(browser, 'onboarding', undefined, (p) => onboarding(p, noShot, true));
  await recordGif(browser, 'cross-chain-swap', state, async (p) => { await unlock(p, true); await crossChainSwap(p, noShot, true); });
  await recordGif(browser, 'send', state, async (p) => { await unlock(p, true); await send(p, noShot, true); });
  await recordGif(browser, 'launch-memecoin', state, async (p) => { await unlock(p, true); await launchToken(p, noShot, true); });
  await recordGif(browser, 'portfolio-receive', state, async (p) => { await unlock(p, true); await homeTour(p, noShot, true); });
  await browser.close();
} finally {
  server.kill();
}
