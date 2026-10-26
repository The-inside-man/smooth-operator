import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try { const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 }); await page.setContent('<style>body{margin:0;background:transparent}</style>' + await fs.readFile('build/icon.svg', 'utf8')); await page.screenshot({ path: 'build/icon.png', omitBackground: true }); }
finally { await browser.close(); }
