// Sonda (só leitura, conta de TESTE): procura no JS do Astrea como a UI chama
// addTagToTask/removeTagFromTask (nomes dos parâmetros). Não chama a API.
// Uso: node scripts/sondar-tag-tarefa.mjs
import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
const scripts = new Map();
page.on('response', async (r) => { if (/\.js(\?|$)/.test(r.url())) { try { scripts.set(r.url(), await r.text()); } catch {} } });
await page.goto('https://astrea.net.br/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('input[placeholder*="email" i]', { timeout: 30_000 });
await page.fill('input[placeholder*="email" i]', process.env.DISC_EMAIL);
await page.fill('input[type="password"]', process.env.DISC_PASS);
await page.click('button:has-text("ENTRAR")');
await page.waitForFunction(() => location.hash.includes('/main/'), null, { timeout: 90_000 });
await page.waitForTimeout(6000);
for (const [url, src] of scripts) {
  for (const m of src.matchAll(/(addTagToTask|removeTagFromTask)/g)) {
    console.log(`[${url.split('/').pop().slice(0, 30)}] …${src.slice(Math.max(0, m.index - 500), m.index + 400).replace(/\s+/g, ' ')}…\n`);
  }
}
await browser.close();
