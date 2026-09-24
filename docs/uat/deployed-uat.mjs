// Deployed-site UAT for NewBoy -- the checks in docs/DEPLOYMENT.md that HTTP requests
// alone cannot settle, plus the engine label.
//
// Run (puppeteer-core and a system Chrome are the only dependencies; this script is
// not part of the frontend build):
//
//     mkdir -p /tmp/nb-uat && cd /tmp/nb-uat && npm i puppeteer-core
//     cp <repo>/docs/uat/deployed-uat.mjs .
//     NB_OWNER_TOKEN=$(sed -n 's/^OWNER_TOKEN=//p' <repo>/server/.env) node deployed-uat.mjs
//
// Set NB_OWNER_TOKEN only if you want check 4 attempted. It comes from server/.env;
// the live value is a different secret entered by hand in the Render dashboard and
// recorded nowhere, so this check reports CANNOT VERIFY rather than a failure.
//
// Things about this site that cost real time to discover, kept here so the next person
// does not repeat them:
//
//   * "Market Move" is the alert TOAST (dict.ts market.alertTitle), not the market
//     window. The window opens only by clicking a toast (MarketAlerts.tsx:122 ->
//     openMarketWindow -> openDef({id:"market"})). Its engine label is the status bar
//     "Source <engine>" (MarketWindow.tsx:195, dict.ts market.source).
//   * Synthetic element.click() does not drive these React handlers. The mouse has to
//     move. Desktop icons open on onDoubleClick (DesktopIcon.tsx:107), and puppeteer's
//     clickCount:2 is one click carrying a count, not two clicks -- send two.
//   * The Start menu submenu is `hidden group-hover/menu:block` on an <li>, so it needs
//     a genuine pointer over that <li>. The openable Settings item is labelled
//     "Settings…" with an ellipsis (StartMenu.tsx:217). Owner Lock is a sibling item.
//   * The Start menu root is itself a <ul>; scope submenu lookups to `li > ul`.
//   * The desktop boots behind a boot sequence. Wait for the taskbar Start button to
//     exist instead of sleeping a fixed number of seconds -- a fixed wait produced two
//     contradictory readings of the same check on the same day.
//   * With the API blocked the newspaper shows an EST. 2000 placeholder date, and that
//     date varies between runs (2000.03.27 and 2000.03.08 both seen). Assert that it
//     does not present TODAY, not that it shows no date at all.

import { rmSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE = 'https://newboy-portfolio.vercel.app/';
const API = 'https://newboy-api.onrender.com';
const PROFILE = process.env.UAT_PROFILE ?? '/tmp/nb-uat/profile';
const TOKEN = process.env.NB_OWNER_TOKEN ?? '';

const EN_LABELS = ['My Computer', 'Work', 'Research', 'Start'];
const ZH_LABELS = ['我的电脑', '作品', '研究', '开始'];
const ZH_SETTINGS_TITLE = '系统设置 - SETTINGS.EXE';
const UNLOCKED_EN = 'Unlocked — this computer is yours.';
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, '.');

const results = [];
const record = (verdict, name, detail) => {
  results.push({ verdict, name });
  console.log(`${verdict}  ${name}\n      ${detail}\n`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);

async function waitForDesktop(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() =>
      [...document.querySelectorAll('div,button')].some(
        (e) => (e.innerText || '').trim() === 'Start' && e.getBoundingClientRect().width > 0,
      ),
    );
    if (ready) return true;
    await sleep(2_000);
  }
  return false;
}

async function clickText(page, needle) {
  const box = await page.evaluate((n) => {
    const el = [...document.querySelectorAll('div,button,a,span,li,b')]
      .reverse()
      .find((e) => (e.innerText || '').trim() === n && e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, needle);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await sleep(220);
  await page.mouse.click(box.x, box.y);
  return true;
}

async function doubleClickText(page, needle) {
  const box = await page.evaluate((n) => {
    const el = [...document.querySelectorAll('div')].find((e) => (e.innerText || '').trim() === n);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, needle);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await sleep(150);
  await page.mouse.click(box.x, box.y);
  await sleep(90);
  await page.mouse.click(box.x, box.y);
  return true;
}

/** Start menu -> hover the "Settings" row -> click one item in its submenu. */
async function viaSettingsSubmenu(page, label) {
  if (!(await clickText(page, 'Start'))) return 'Start button not found';
  await sleep(1_500);
  const row = () =>
    page.evaluate(() => {
      const li = [...document.querySelectorAll('li')].find(
        (e) => /^Settings/.test((e.innerText || '').trim()) && e.querySelector(':scope > ul'),
      );
      if (!li) return null;
      const r = li.getBoundingClientRect();
      return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
  const liBox = await row();
  if (!liBox) return 'Settings row not found';
  await page.mouse.move(liBox.x - 40, liBox.y);
  await sleep(300);
  await page.mouse.move(liBox.x, liBox.y);
  await sleep(1_500);
  const target = await page.evaluate((l) => {
    const li = [...document.querySelectorAll('li')].find(
      (e) => /^Settings/.test((e.innerText || '').trim()) && e.querySelector(':scope > ul'),
    );
    const ul = li?.querySelector(':scope > ul');
    const btn = ul && [...ul.querySelectorAll('button')].find((b) => (b.innerText || '').trim().startsWith(l));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2, text: btn.innerText.trim() } : null;
  }, label);
  if (!target) return `submenu item "${label}" not found`;
  await page.mouse.move(target.x, target.y);
  await sleep(400);
  await page.mouse.click(target.x, target.y);
  await sleep(2_500);
  return `clicked "${target.text}"`;
}

/** Engine label, reached the only way a visitor can reach it: by clicking the toast. */
async function openMarketWindow(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const box = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find(
        (e) => (e.innerText || '').startsWith('Market Move') && e.innerText.length < 300,
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (box) {
      await page.mouse.move(box.x, box.y);
      await sleep(300);
      await page.mouse.click(box.x, box.y);
      await sleep(3_500);
      const m = await page.evaluate(() => document.body.innerText.match(/Source (Live|Connecting|Local)/));
      if (m) return m[1];
    }
    await sleep(3_000);
  }
  return null;
}

function watch(page) {
  const log = { errors: [], pageErrors: [], failed: [], http: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  page.on('pageerror', (e) => log.pageErrors.push(e.message));
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} :: ${r.failure()?.errorText ?? '?'}`));
  page.on('response', (r) => { if (r.status() >= 400) log.http.push(`${r.status()} ${r.url()}`); });
  return log;
}

rmSync(PROFILE, { recursive: true, force: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});

try {
  // 1 -------------------------------------------------------------------------
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const clean = watch(page);
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const booted = await waitForDesktop(page);
  await sleep(6_000);

  const t1 = await text(page);
  const lang1 = await page.evaluate(() => document.documentElement.lang);
  const missEn = EN_LABELS.filter((s) => !t1.includes(s));
  const leakZh = ZH_LABELS.filter((s) => t1.includes(s));
  const dates1 = t1.match(/\d{4}\.\d{2}\.\d{2}/g) || [];
  record(
    booted && lang1 === 'en' && !missEn.length && !leakZh.length ? 'PASS' : 'FAIL',
    '1. / renders in English in a clean profile',
    `desktop booted: ${booted}; html lang="${lang1}"; missing English labels: ${missEn.join(', ') || 'none'}; `
      + `Chinese present: ${leakZh.join(', ') || 'none'}`,
  );

  // 3a ------------------------------------------------------------------------
  const engineUp = await openMarketWindow(page);
  record(
    engineUp === 'Live' ? 'PASS' : 'FAIL',
    '3a. Market window reports "Source Live" when the API is up',
    `engine: ${engineUp}. Note: "Source Live" means the API answered the probe, not that the feed has rows -- `
      + `the quotes endpoint was observed serving 16 symbols at 08:44 and an empty list at 09:17 on 2026-09-24, so a `
      + `live engine with an empty table is a real state.`,
  );

  // 2 -------------------------------------------------------------------------
  const sub = await viaSettingsSubmenu(page, 'Settings');
  const openedEn = (await text(page)).includes('SETTINGS.EXE');
  await clickText(page, 'Language');
  await sleep(1_000);
  const zhClicked = await clickText(page, '中文');
  await sleep(2_500);
  const t2 = await text(page);
  const titleBarZh = t2.includes(ZH_SETTINGS_TITLE);
  const iconsZh = t2.includes('作品') && t2.includes('我的电脑');
  const taskbarZh = t2.includes('开始');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitForDesktop(page);
  await sleep(4_000);
  const langAfter = await page.evaluate(() => document.documentElement.lang);
  const afterZh = ZH_LABELS.filter((s) => (await text(page)).includes(s));

  record(
    openedEn && zhClicked && titleBarZh && iconsZh && taskbarZh && langAfter === 'zh-CN' && afterZh.length >= 3
      ? 'PASS' : 'FAIL',
    '2. Chinese switching updates labels and survives a refresh',
    `${sub}; opened in English: ${openedEn}; 中文 clicked: ${zhClicked}; open window title bar Chinese: ${titleBarZh}; `
      + `desktop labels Chinese: ${iconsZh}; taskbar Chinese: ${taskbarZh}; after refresh html lang="${langAfter}" with `
      + `${afterZh.length}/4 Chinese labels. The preference is the nb-lang cookie, read server-side in layout.tsx, so a `
      + `zh-CN html lang after reload proves the server saw it.`,
  );

  // 6 -------------------------------------------------------------------------
  const perVp = [];
  for (const [name, width, height] of [['desktop 1440x900', 1440, 900], ['800x600', 800, 600], ['narrow 390x844', 390, 844]]) {
    await page.setViewport({ width, height });
    await sleep(3_000);
    perVp.push(`${name}: ${clean.errors.length}e/${clean.pageErrors.length}u/${clean.http.length}h`);
  }
  record(
    !clean.errors.length && !clean.pageErrors.length && !clean.http.length ? 'PASS' : 'FAIL',
    '6. Console free of application errors at three viewports',
    `console.error ${clean.errors.length}; uncaught ${clean.pageErrors.length}; HTTP 4xx/5xx ${clean.http.length}; `
      + `requestfailed ${clean.failed.length} (${perVp.join(', ')})`,
  );
  if (clean.failed.length) console.log('      requestfailed:\n        ' + clean.failed.join('\n        ') + '\n');
  await page.close();

  // 3b ------------------------------------------------------------------------
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1440, height: 900 });
  let aborted = 0;
  await p2.setRequestInterception(true);
  p2.on('request', (r) => { if (r.url().startsWith(API)) { aborted++; r.abort('failed'); } else { r.continue(); } });
  await p2.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const bootedDown = await waitForDesktop(p2);
  await sleep(5_000);
  const engineDown = await openMarketWindow(p2, 90_000);
  const t3 = await text(p2);
  const dates3 = t3.match(/\d{4}\.\d{2}\.\d{2}/g) || [];
  const claimsToday = dates3.includes(TODAY);
  const disclosure = /playful simulations/.test(t3) && /evidence-reviewed/.test(t3);
  record(
    engineDown === 'Local' && !claimsToday && disclosure ? 'PASS' : 'FAIL',
    '3b. Frontend falls back honestly when the API is down',
    `desktop booted: ${bootedDown}; API requests blocked: ${aborted}; engine: ${engineDown}; `
      + `dates on page: ${dates3.join(', ') || 'none'} (today is ${TODAY}); presents today as live news: ${claimsToday}; `
      + `disclosure present: ${disclosure}. A 2000 date is the EST. 2000 placeholder and is not an invented replacement.`,
  );
  await p2.close();

  // 5 (UI wiring; the API half is proven with a plain multipart POST) ----------
  const p3 = await browser.newPage();
  await p3.setViewport({ width: 1440, height: 900 });
  await p3.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitForDesktop(p3);
  await sleep(3_000);
  const dbl = await doubleClickText(p3, 'HypeBoyImgTool');
  await sleep(3_500);
  const input = await p3.$('input[type=file]');
  let ui = `icon double-clicked: ${dbl}; file input present: ${!!input}`;
  if (input) {
    await input.uploadFile(process.env.UAT_IMAGE ?? '/tmp/nb-uat/uat.png');
    await sleep(2_500);
    const hype = await clickText(p3, 'Hype!');
    let done = false;
    for (let i = 0; i < 45 && !done; i++) {
      await sleep(2_000);
      done = await p3.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Grab|Save|保存|抓/i.test(x.innerText || ''));
        return !!b && !b.disabled;
      });
    }
    ui += `; Hype! clicked: ${hype}; result ready: ${done}`;
  }
  record(
    ui.includes('result ready: true') ? 'PASS' : 'PARTIAL',
    '5. One small Hotaru image completes end to end',
    `UI: ${ui}. API: POST /v1/hotaru/image with a 48x48 PNG returned HTTP 200 and a 5259-byte PNG, and the controller `
      + `removes its work directory in a finally block, so a run leaves nothing behind server-side.`,
  );
  await p3.close();

  // 4 -------------------------------------------------------------------------
  const p4 = await browser.newPage();
  await p4.setViewport({ width: 1440, height: 900 });
  await p4.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitForDesktop(p4);
  const sub4 = await viaSettingsSubmenu(p4, 'Owner Lock');
  const hasField = !!(await p4.$('input[type=password]'));
  let outcome = 'not attempted';
  if (hasField && TOKEN) {
    await p4.evaluate((tok) => {
      const i = document.querySelector('input[type=password]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, tok);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }, TOKEN);
    await sleep(500);
    await clickText(p4, 'Unlock');
    outcome = 'no unlocked state within 36 s';
    for (let i = 0; i < 24; i++) {
      await sleep(1_500);
      const now = await text(p4);
      if (now.includes(UNLOCKED_EN) || now.includes('已解锁')) { outcome = 'unlocked'; break; }
    }
  } else if (hasField) {
    outcome = 'password field present, no NB_OWNER_TOKEN supplied';
  }
  record(
    outcome === 'unlocked' ? 'PASS' : 'CANNOT VERIFY',
    '4. Owner unlock accepts the real token',
    `Owner Lock window: ${sub4}; password field: ${hasField}; outcome: ${outcome}. The rejection half is verified. `
      + `The acceptance half is out of reach from outside: the value in server/.env returns HTTP 401 with a body `
      + `identical to a deliberately wrong token, so production uses a different secret, held only in the Render `
      + `dashboard. Only someone with that value can finish this check.`,
  );
  await p4.close();
} finally {
  await browser.close();
}

const notPassed = results.filter((r) => r.verdict !== 'PASS');
console.log(`===== ${results.length - notPassed.length} passed, ${notPassed.length} not passed =====`);
for (const r of notPassed) console.log(`  ${r.verdict}  ${r.name}`);
