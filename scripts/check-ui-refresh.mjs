import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('artifacts/ui-refresh', { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'frontend', '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { windowsHide: true, stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { server.kill(); reject(new Error('Frontend startup timed out')); }, 15000);
  server.stdout.on('data', data => { if (String(data).includes('ready')) { clearTimeout(timeout); resolve(); } });
  server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Frontend exited: ${code}`)); });
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  // Never send requests to the database-backed API during visual checks.
  await page.route('**/api/**', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [label, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const path of ['/login', '/register']) {
      await page.goto('http://127.0.0.1:5186' + path);
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
      await page.screenshot({ path: `artifacts/ui-refresh/${label}-${path.slice(1)}.png`, fullPage: true });
      const content = await page.evaluate(() => document.documentElement.scrollWidth);
      if (content > width) throw new Error(`${label} ${path} overflows: ${content} > ${width}`);
      console.log(`${label} ${path}: no horizontal overflow`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); server.kill(); }
