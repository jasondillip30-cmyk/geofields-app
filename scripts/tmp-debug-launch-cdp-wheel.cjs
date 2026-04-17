const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function waitForHydratedApp(page, timeoutMs = 30000) {
  await page.waitForFunction(() => document.documentElement.dataset.gfHydrated === '1', undefined, {
    timeout: timeoutMs,
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await page.goto(`${baseUrl}/login?`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill('admin@geofields.co.tz');
  await page.locator('input[type="password"]').first().fill('Admin123!');
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
  await waitForHydratedApp(page);

  await page.goto(`${baseUrl}/rigs?workspace=all-projects&projectId=all&clientId=all&rigId=all&launch=1`, { waitUntil: 'domcontentloaded' });
  await waitForHydratedApp(page);

  const launchLayer = page.getByTestId('workspace-launch-layer');
  await launchLayer.waitFor({ state: 'visible', timeout: 30000 });

  const box = await launchLayer.boundingBox();
  if (!box) throw new Error('no box');

  async function readState(label) {
    const snapshot = await page.evaluate(() => {
      const el = document.querySelector("[data-testid='workspace-launch-layer']");
      if (!el) return null;
      return { className: el.className, transform: el.style.transform };
    });
    console.log(label, { url: page.url(), snapshot });
  }

  await readState('before');

  const x = Math.floor(box.x + box.width / 2);
  const topY = Math.floor(box.y + 36);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: topY, button: 'none' });
  for (let i = 0; i < 8; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y: topY, deltaX: 0, deltaY: 220 });
  }
  await page.waitForTimeout(700);
  await readState('after-top-wheel');

  const bottomY = Math.floor(box.y + box.height - 16);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: bottomY, button: 'none' });
  for (let i = 0; i < 8; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y: bottomY, deltaX: 0, deltaY: 220 });
  }
  await page.waitForTimeout(1200);
  await readState('after-bottom-wheel');

  async function dispatchTouchSwipe(startY, endY) {
    const steps = 12;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y: startY, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
    });
    for (let i = 1; i <= steps; i += 1) {
      const y = Math.round(startY + ((endY - startY) * i) / steps);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
      });
      await page.waitForTimeout(12);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  await page.goto(`${baseUrl}/rigs?workspace=all-projects&projectId=all&clientId=all&rigId=all&launch=1`, { waitUntil: 'domcontentloaded' });
  await waitForHydratedApp(page);
  await launchLayer.waitFor({ state: 'visible', timeout: 30000 });
  await readState('before-touch');
  await dispatchTouchSwipe(topY, Math.max(20, topY - 280));
  await page.waitForTimeout(700);
  await readState('after-top-touch');

  await page.goto(`${baseUrl}/rigs?workspace=all-projects&projectId=all&clientId=all&rigId=all&launch=1`, { waitUntil: 'domcontentloaded' });
  await waitForHydratedApp(page);
  await launchLayer.waitFor({ state: 'visible', timeout: 30000 });
  const bottomStartY = Math.floor(box.y + box.height - 22);
  await readState('before-bottom-touch');
  await dispatchTouchSwipe(bottomStartY, Math.max(18, bottomStartY - 320));
  await page.waitForTimeout(1200);
  await readState('after-bottom-touch');

  await context.close();
  await browser.close();
})();
