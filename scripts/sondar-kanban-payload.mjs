// Sonda (só leitura, conta de TESTE): trechos do bundle que montam o payload de
// criação de tarefa/prazo/audiência/compromisso com kanbanId/kanbanColumnId.
// Não chama APIs de escrita. Uso: node scripts/sondar-kanban-payload.mjs
import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
let bundle = '';
page.on('response', async (r) => { if (/all\.min\.js/.test(r.url())) { try { bundle = await r.text(); } catch {} } });
await page.goto('https://astrea.net.br/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('input[placeholder*="email" i]', { timeout: 30_000 });
await page.fill('input[placeholder*="email" i]', process.env.DISC_EMAIL);
await page.fill('input[type="password"]', process.env.DISC_PASS);
await page.click('button:has-text("ENTRAR")');
await page.waitForFunction(() => location.hash.includes('/main/'), null, { timeout: 90_000 });
await page.waitForTimeout(4000);

const alvos = [/kanbanId\s*:/g, /NONE_KANBAN_BOARD\s*=/g, /taskInfoDTO/g, /saveTaskWithList/g];
const vistos = new Set();
for (const re of alvos) {
  let n = 0;
  for (const m of bundle.matchAll(re)) {
    const ini = Math.max(0, m.index - 600);
    const chave = Math.floor(ini / 400);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    console.log(`\n--- ${re.source} @${m.index} ---\n…${bundle.slice(ini, m.index + 600).replace(/\s+/g, ' ')}…`);
    if (++n >= 15) break;
  }
}
await browser.close();
