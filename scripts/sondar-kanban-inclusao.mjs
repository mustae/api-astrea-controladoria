// Sonda (só leitura, conta de TESTE do .env DISC_*): como a UI do Astrea inclui
// tarefa/prazo/audiência/compromisso num quadro Kanban. Lista os quadros e procura no
// bundle os usos de kanbanId/kanbanColumnId/kanbanDetails e das rotas /kanbans.
// Uso: node scripts/sondar-kanban-inclusao.mjs  (com a API parada)
import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })).newPage();
let bundle = '';
page.on('response', async (r) => { if (/all\.min\.js/.test(r.url())) { try { bundle = await r.text(); } catch {} } });
await page.goto('https://astrea.net.br/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('input[placeholder*="email" i]', { timeout: 30_000 });
await page.fill('input[placeholder*="email" i]', process.env.DISC_EMAIL);
await page.fill('input[type="password"]', process.env.DISC_PASS);
await page.click('button:has-text("ENTRAR")');
await page.waitForFunction(() => location.hash.includes('/main/'), null, { timeout: 90_000 });
await page.waitForFunction(() => !!window.angular?.element(document.body)?.injector()?.get('$http'), null, { timeout: 60_000 });
await page.waitForTimeout(3000);

const quadros = await page.evaluate(async () => {
  const http = window.angular.element(document.body).injector().get('$http');
  try { return (await http.get('https://app.astrea.net.br/api/v2/kanbans')).data; } catch (e) { return { erro: e.status }; }
});
console.log('== QUADROS ==');
console.log(JSON.stringify(Array.isArray(quadros) ? quadros.map((q) => ({ id: String(q.id), nome: q.name, padrao: q.default, colunas: q.columns.map((c) => `${c.id}:${c.name}:${c.type}`) })) : quadros, null, 1));

const vistos = new Set();
for (const re of [/\/kanbans[^"'`\s]*/g, /kanbanColumnId/g, /addToKanban|removeFromKanban|includeInKanban|KANBAN_[A-Z_]+/g, /kanbanDetails/g]) {
  let n = 0;
  for (const m of bundle.matchAll(re)) {
    const trecho = bundle.slice(Math.max(0, m.index - 350), m.index + 350).replace(/\s+/g, ' ');
    const chave = trecho.slice(200, 500);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    console.log(`\n--- ${re.source} ---\n…${trecho}…`);
    if (++n >= 12) break;
  }
}
await browser.close();
