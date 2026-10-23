// Sonda (só leitura, conta de TESTE): procura no JS do Astrea os valores de `order`
// da lista de processos e como o filtro `createddate` é usado. Não chama APIs de escrita.
// Uso: node scripts/sondar-bundle-ordem.mjs
import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
const scripts = new Map();
page.on('response', async (r) => {
  if (/\.js(\?|$)/.test(r.url()) && /astrea/.test(r.url())) { try { scripts.set(r.url(), await r.text()); } catch {} }
});
await page.goto('https://astrea.net.br/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('input[placeholder*="email" i]', { timeout: 30_000 });
await page.fill('input[placeholder*="email" i]', process.env.DISC_EMAIL);
await page.fill('input[type="password"]', process.env.DISC_PASS);
await page.click('button:has-text("ENTRAR")');
await page.waitForFunction(() => location.hash.includes('/main/'), null, { timeout: 90_000 });
await page.evaluate(() => { location.hash = '#/main/folder'; });
await page.waitForTimeout(8000);

const padroes = [/["'][-]?lastMovement["']/g, /createddate/gi, /DateEnum/g, /["']-?(created|creation)[A-Za-z]*["']/g, /case-list\/[a-z-]+/g];
for (const [url, src] of scripts) {
  for (const re of padroes) {
    for (const m of src.matchAll(re)) {
      const i = m.index;
      console.log(`[${url.split('/').pop().slice(0, 40)}] ${re.source}: …${src.slice(Math.max(0, i - 160), i + 200).replace(/\s+/g, ' ')}…\n`);
    }
  }
}
console.log('scripts lidos:', scripts.size);
await browser.close();
