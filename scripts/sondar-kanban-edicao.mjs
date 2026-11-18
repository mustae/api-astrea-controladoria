// Sonda (só leitura, conta de TESTE do .env DISC_*): como a UI do Astrea troca o quadro
// Kanban de uma atividade já criada (move entre quadros, tira do Kanban), a ordem das
// colunas em /kanbans e as etiquetas com "audi" no nome. Não chama APIs de escrita.
// Uso: node scripts/sondar-kanban-edicao.mjs  (com a API parada)
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

const get = (p) => page.evaluate(async (p) => {
  const http = window.angular.element(document.body).injector().get('$http');
  try { return (await http.get('https://app.astrea.net.br/api/v2' + p)).data; } catch (e) { return { erro: e.status }; }
}, p);

console.log('== QUADROS (colunas na ordem do GET, com todas as chaves) ==');
for (const q of (await get('/kanbans')) ?? []) console.log(q.name, JSON.stringify(q.columns));

const tags = await get('/tags');
const lista = Array.isArray(tags) ? tags : tags?.tags ?? tags?.content ?? [];
console.log('\n== ETIQUETAS com "audi" ==');
console.log(JSON.stringify(lista.filter((t) => /audi/i.test(t.label ?? t.name ?? '')), null, 1));
if (!lista.length) console.log('formato /tags:', JSON.stringify(tags).slice(0, 400));

const vistos = new Set();
for (const re of [/NONE_KANBAN_BOARD/g, /\/move[^"'`\s]{0,40}/g, /targetColumnId|targetKanbanId|changeKanban|moveToKanban|removeFromKanban|activities\/[^"'`\s]{0,60}/g]) {
  let n = 0;
  for (const m of bundle.matchAll(re)) {
    const trecho = bundle.slice(Math.max(0, m.index - 400), m.index + 400).replace(/\s+/g, ' ');
    const chave = trecho.slice(250, 550);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    console.log(`\n--- ${re.source} ---\n…${trecho}…`);
    if (++n >= 10) break;
  }
}
await browser.close();
