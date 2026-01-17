// src/main.js
import { Actor } from 'apify';
import { chromium } from 'playwright';

function normDate(input) {
  if (!input) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-');
    return `${m}/${d}/${y}`;
  }
  return input;
}

async function saveDebug(page, kv, keyBase, { html = true, png = true } = {}) {
  const safeKey = keyBase.replace(/[^\w.-]+/g, '_');
  if (html) {
    const content = await page.content();
    await kv.setValue(`${safeKey}.html`, content, { contentType: 'text/html; charset=utf-8' });
  }
  if (png) {
    const buf = await page.screenshot({ fullPage: true });
    await kv.setValue(`${safeKey}.png`, buf, { contentType: 'image/png' });
  }
}

async function failWithArtifacts({ page, kv, key, reason, debugHtml, debugScreenshots }) {
  await saveDebug(page, kv, key, { html: debugHtml, png: debugScreenshots });
  await kv.setValue('RESULT.json', JSON.stringify({ ok: false, reason }), { contentType: 'application/json; charset=utf-8' });
  throw new Error(reason);
}

async function clickByText(page, candidates) {
  for (const text of candidates) {
    const loc = page.locator(`a:has-text("${text}")`).first();
    if (await loc.count()) {
      try {
        await loc.click({ timeout: 2000 });
        return true;
      } catch {}
    }
  }
  return false;
}

async function maybeHandleClientAccountSelection(page, paymentClientAccountValue) {
  if (!paymentClientAccountValue) return false;
  const bodyText = (await page.textContent('body')) || '';
  const looksLikeAccountPrompt = /client account|payment account|select.*account/i.test(bodyText);
  if (!looksLikeAccountPrompt) return false;

  const selects = page.locator('select');
  if (await selects.count()) {
    for (let i = 0; i < (await selects.count()); i++) {
      const s = selects.nth(i);
      try {
        await s.selectOption({ label: paymentClientAccountValue });
        return true;
      } catch {}
      try {
        await s.selectOption({ value: paymentClientAccountValue });
        return true;
      } catch {}
    }
  }

  const radios = page.locator('input[type="radio"]');
  if (await radios.count()) {
    for (let i = 0; i < (await radios.count()); i++) {
      const r = radios.nth(i);
      const v = (await r.getAttribute('value')) || '';
      if (v.trim() === String(paymentClientAccountValue).trim()) {
        await r.check();
        return true;
      }
    }
  }

  const link = page.locator(`text="${paymentClientAccountValue}"`).first();
  if (await link.count()) {
    try {
      await link.click();
      return true;
    } catch {}
  }
  return false;
}

Actor.main(async () => {
  const input = await Actor.getInput() ?? {};
  const {
    username,
    password,
    headless = true,
    harvestMode = 'oneDay',
    targetDate,
    maxPages = 250,
    navTimeoutMs = 120000,
    selectorTimeoutMs = 60000,
    paymentClientAccountValue = '',
    searchWildcard = '*.*',
    debugHtml = true,
    debugScreenshots = true,
  } = input;

  const kv = await Actor.openKeyValueStore();
  const dataset = await Actor.openDataset();
  const browser = await chromium.launch({ headless: !!headless });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(navTimeoutMs);
  page.setDefaultTimeout(selectorTimeoutMs);

  try {
    await page.goto('https://direct.sos.state.tx.us/acct/acct-login.asp', { waitUntil: 'domcontentloaded' });
    await saveDebug(page, kv, 'A0_LOGOUT_RESET', { html: debugHtml, png: debugScreenshots });
    await saveDebug(page, kv, 'A1_LOGIN_PAGE', { html: debugHtml, png: debugScreenshots });

    const userLoc = page.locator('input[name="userId"], input[name="userid"], input[name="UserID"], input[type="text"]').first();
    const passLoc = page.locator('input[name="password"], input[name="Password"], input[type="password"]').first();
    await userLoc.fill(String(username ?? ''));
    await passLoc.fill(String(password ?? ''));
    await saveDebug(page, kv, 'A2_LOGIN_FILLED', { html: debugHtml, png: debugScreenshots });

    const submit = page.locator('input[type="submit"], button[type="submit"], input[value*="Submit" i], input[value*="Login" i]').first();
    if (await submit.count()) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), submit.click()]);
    } else {
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), passLoc.press('Enter')]);
    }
    await saveDebug(page, kv, 'A3_AFTER_SUBMIT', { html: debugHtml, png: debugScreenshots });

    const didSelect = await maybeHandleClientAccountSelection(page, paymentClientAccountValue);
    if (didSelect) {
      const cont = page.locator('input[type="submit"], button[type="submit"], input[value*="Continue" i], input[value*="Submit" i]').first();
      if (await cont.count()) {
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), cont.click()]);
      }
      await saveDebug(page, kv, 'A5_LOGIN1_AFTER_SELECT', { html: debugHtml, png: debugScreenshots });
    } else {
      const body = (await page.textContent('body')) || '';
      if (/payment.*missing|must.*select.*account/i.test(body)) {
        await failWithArtifacts({
          page, kv, key: 'FAIL_LOGIN1_PAYMENT_MISSING',
          reason: 'Login succeeded but SOSDirect requires selecting a client/payment account.',
          debugHtml, debugScreenshots,
        });
      }
    }
        const wentToBO = await clickByText(page, ['Business Organizations', 'BUSINESS ORGANIZATIONS']);
    if (wentToBO) {
      await page.waitForLoadState('domcontentloaded');
    }
    await saveDebug(page, kv, 'A8_HOME_CORP', { html: debugHtml, png: debugScreenshots });

    const wentToRA60 = await clickByText(page, [
      'Registered Agent activity past 60 days',
      'Registered Agent activity',
      'Registered Agent Activity past 60 days',
    ]);

    if (!wentToRA60) {
      await failWithArtifacts({
        page, kv, key: 'FAIL_RA_60_NOT_REACHED',
        reason: 'Could not find the "Registered Agent activity past 60 days" link.',
        debugHtml, debugScreenshots,
      });
    }

    await page.waitForLoadState('domcontentloaded');
    await saveDebug(page, kv, 'A9_RA_60_PAGE', { html: debugHtml, png: debugScreenshots });

    const dateStr = normDate(targetDate);
    if (dateStr) {
      const dateInput = page.locator('input[name*="date" i], input[id*="date" i]').first();
      if (await dateInput.count()) {
        await dateInput.fill(dateStr);
      }
    }

    if (searchWildcard) {
      const wildcard = page.locator('input[name*="name" i], input[id*="name" i]').first();
      if (await wildcard.count()) {
        await wildcard.fill(String(searchWildcard));
      }
    }

    await saveDebug(page, kv, 'A10_RA_SEARCH_FILLED', { html: debugHtml, png: debugScreenshots });

    const searchBtn = page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first();
    if (await searchBtn.count()) {
      await searchBtn.click();
      await page.waitForLoadState('domcontentloaded');
    } else {
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded');
    }

    await saveDebug(page, kv, 'A11_RA_RESULTS_PAGE_1', { html: debugHtml, png: debugScreenshots });

    let pageNum = 1;
    let total = 0;

    while (pageNum <= maxPages) {
      const tables = page.locator('table');
      let bestTable = null;
      const tableCount = await tables.count();

      for (let i = 0; i < tableCount; i++) {
        const t = tables.nth(i);
        const rows = t.locator('tr');
        const rc = await rows.count();
        if (rc >= 2) {
          bestTable = t;
          break;
        }
      }

      if (!bestTable) break;

      const rows = bestTable.locator('tr');
      const rowCount = await rows.count();

      for (let r = 1; r < rowCount; r++) {
        const cols = rows.nth(r).locator('td');
        const colCount = await cols.count();
        if (colCount === 0) continue;

        const values = [];
        for (let c = 0; c < colCount; c++) {
          values.push(((await cols.nth(c).innerText()) || '').trim());
        }

        if (values.join('').trim().length === 0) continue;

        await dataset.pushData({
          page: pageNum,
          columns: values,
        });
        total += 1;
      }

      const nextLink = page.locator('a:has-text("Next")').first();
      if (!(await nextLink.count())) break;

      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
          nextLink.click(),
        ]);
        pageNum += 1;
      } catch {
        break;
      }
    }

    await kv.setValue(
      'RESULT.json',
      JSON.stringify({ ok: true, total, pagesProcessed: pageNum }),
      { contentType: 'application/json; charset=utf-8' },
    );

    await saveDebug(page, kv, 'A12_HARVEST_COMPLETE', { html: debugHtml, png: debugScreenshots });
  } finally {
    await browser.close();
  }
});