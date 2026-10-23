// Sonda (só leitura, conta de TESTE do .env DISC_*): plano B de processos_novos_por_mes.
// Testa valores de `order` em /case/query e mostra quais campos de data cada item traz.
// Imprime só nomes de campos, datas e contagens — nenhum dado de cliente.
//
// Uso: node scripts/sondar-ordem-cadastro.mjs

import 'dotenv/config';
import { chromium } from 'playwright';

const EMAIL = process.env.DISC_EMAIL;
const PASS = process.env.DISC_PASS;
if (!EMAIL || !PASS) { console.error('Defina DISC_EMAIL e DISC_PASS no .env.'); process.exit(1); }

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })).newPage();
await page.goto('https://astrea.net.br/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('input[placeholder*="email" i]', { timeout: 30_000 });
await page.fill('input[placeholder*="email" i]', EMAIL);
await page.fill('input[type="password"]', PASS);
await page.click('button:has-text("ENTRAR")');
await page.waitForFunction(() => location.hash.includes('/main/'), null, { timeout: 90_000 });
await page.waitForFunction(() => !!window.angular?.element(document.body)?.injector()?.get('$http'), null, { timeout: 60_000 });
await page.waitForTimeout(3000);
const userId = Number(await page.evaluate(() => window.angular.element(document.body).scope()?.$root?.userInfo?.id));

function dto(order) {
  return {
    contacts: [], lawsuitTypes: [], titles: [], folders: [], courts: [], stakeholderRoles: [],
    divisionNames: [], numbers: [], users: [], userId, order, types: [], instances: [],
    status: null, tagIds: [], treeView: false, onlyImportant: null, notUpdated: null,
    isFromContactScreen: false, treeMode: false, historiesMovement: null, createddate: null,
    shareddate: null, endeddate: null, team: null,
  };
}
async function query(order, cursor = '', limit = 5) {
  return page.evaluate(async (body) => {
    const http = window.angular.element(document.body).injector().get('$http');
    try { const r = await http.post('https://app.astrea.net.br/api/v2/case/query', body); return { data: r.data }; }
    catch (e) { return { erro: `${e.status}: ${JSON.stringify(e.data ?? '').slice(0, 300)}` }; }
  }, { userId, limit, queryCursor: cursor, queryDTO: dto(order), currentOrder: order });
}

const datey = (k, v) => /date|time|created|creat|cadast|insert|since|at$/i.test(k) || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) || (typeof v === 'number' && v > 1e12 && v < 3e12);
const primeiro = await query('-lastMovement');
if (primeiro.erro) { console.log('ERRO base', primeiro.erro); process.exit(1); }
const c0 = primeiro.data.cases?.[0] ?? {};
console.log('chaves do item:', Object.keys(c0).join(', '));
console.log('chaves de topo da resposta:', Object.keys(primeiro.data).join(', '));
console.log('campos de data do item:', JSON.stringify(Object.fromEntries(Object.entries(c0).filter(([k, v]) => datey(k, v)))));

const ordens = ['createdDate', '-createdDate', 'creationDate', '-creationDate', 'dateCreated', '-dateCreated', 'createdAt', '-createdAt', 'created', '-created', 'registerDate', '-registerDate', 'id', '-id', 'title', '-lastMovement', 'lastMovement'];
for (const o of ordens) {
  const r = await query(o);
  if (r.erro) { console.log(`${o.padEnd(16)} → ERRO ${r.erro}`); continue; }
  const cs = r.data.cases ?? [];
  const resumo = cs.map((c) => JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k, v]) => datey(k, v))))).join(' | ');
  console.log(`${o.padEnd(16)} → ${cs.length} itens; ids ${cs.map((c) => c.id).join(',')}; cursor ${String(r.data.cursor ?? '').slice(0, 60)}\n   datas: ${resumo.slice(0, 600)}`);
}
await browser.close();
