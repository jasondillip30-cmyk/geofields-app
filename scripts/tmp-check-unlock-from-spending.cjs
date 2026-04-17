const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function waitForHydratedApp(page, timeoutMs = 30000) {
  await page.waitForFunction(() => document.documentElement.dataset.gfHydrated === '1', undefined, {
    timeout: timeoutMs,
  });
}

async function login(page) {
  await page.goto(`${baseUrl}/login?`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill('admin@geofields.co.tz');
  await page.locator('input[type="password"]').first().fill('Admin123!');
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
  await waitForHydratedApp(page);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  await login(page);

  const projectsRes = await page.request.get(`${baseUrl}/api/projects`);
  const projectsJson = await projectsRes.json();
  const projectId = projectsJson?.data?.[0]?.id;
  if (!projectId) throw new Error('No project id');

  const spendingUrl = `${baseUrl}/spending?workspace=project&projectId=${projectId}&clientId=all&rigId=all&launch=1`;
  await page.goto(spendingUrl, { waitUntil: 'domcontentloaded' });
  await waitForHydratedApp(page);

  const launchLayer = page.getByTestId('workspace-launch-layer');
  await launchLayer.waitFor({ state: 'visible', timeout: 30000 });

  async function state(label) {
    const snapshot = await page.evaluate(() => {
      const el = document.querySelector("[data-testid='workspace-launch-layer']");
      return el ? { transform: el.style.transform, className: el.className } : null;
    });
    console.log(label, page.url(), snapshot);
  }

  await state('before');

  const box = await launchLayer.boundingBox();
  if (!box) throw new Error('No launch layer bounds');
  const x = Math.round(box.x + box.width / 2);
  const topY = Math.round(box.y + 40);
  const bottomY = Math.round(box.y + box.height - 20);

  await page.evaluate(({ y }) => {
    const el = document.querySelector("[data-testid='workspace-launch-layer']");
    if (!el) return;
    for (let i = 0; i < 8; i += 1) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 220, clientY: y, bubbles: true, cancelable: true }));
    }
  }, { y: topY });
  await page.waitForTimeout(400);
  await state('after-top-synth-wheel');

  await page.evaluate(({ y }) => {
    const el = document.querySelector("[data-testid='workspace-launch-layer']");
    if (!el) return;
    for (let i = 0; i < 8; i += 1) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 220, clientY: y, bubbles: true, cancelable: true }));
    }
  }, { y: bottomY });
  await page.waitForTimeout(1200);
  await state('after-bottom-synth-wheel');

  await page.goto(spendingUrl, { waitUntil: 'domcontentloaded' });
  await waitForHydratedApp(page);
  await launchLayer.waitFor({ state: 'visible', timeout: 30000 });

  await page.evaluate(({ x, startY, endY }) => {
    const el = document.querySelector("[data-testid='workspace-launch-layer']");
    if (!el) return;
    const mkTouch = (y) => ({ identifier: 1, target: el, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 });
    const startTouch = mkTouch(startY);
    const startEvt = new TouchEvent('touchstart', { touches: [startTouch], targetTouches: [startTouch], changedTouches: [startTouch], bubbles: true, cancelable: true });
    el.dispatchEvent(startEvt);
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      const y = Math.round(startY + ((endY - startY) * i) / steps);
      const moveTouch = mkTouch(y);
      const moveEvt = new TouchEvent('touchmove', { touches: [moveTouch], targetTouches: [moveTouch], changedTouches: [moveTouch], bubbles: true, cancelable: true });
      el.dispatchEvent(moveEvt);
    }
    const endEvt = new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [mkTouch(endY)], bubbles: true, cancelable: true });
    el.dispatchEvent(endEvt);
  }, { x, startY: bottomY, endY: Math.max(18, bottomY - 320) });
  await page.waitForTimeout(1200);
  await state('after-bottom-synth-touch');

  await context.close();
  await browser.close();
})();
