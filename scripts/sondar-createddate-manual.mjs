// Sonda (só leitura, conta de TESTE do .env DISC_*): confirma createddate "MANUAL" + fromDate/toDate
// em /case-list/count (o bundle do Astrea usa "MANUAL" quando o usuário digita as datas do período).
// Imprime o trecho buildPeriodFields do bundle e contagens — nenhum dado de cliente.
// Uso: node scripts/sondar-createddate-manual.mjs
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
const userId = Number(await page.evaluate(() => window.angular.element(document.body).scope()?.$root?.userInfo?.id));

for (const marca of ['function buildPeriodFields', 'MANUAL', 'fromDate']) {
  let i = bundle.indexOf(marca), n = 0;
  while (i >= 0 && n < 4) { console.log(`--- ${marca} ---\n${bundle.slice(Math.max(0, i - 300), i + 1500)}\n`); i = bundle.indexOf(marca, i + 1); n++; if (marca === 'function buildPeriodFields') break; }
}

function dto(extra) {
  return { contacts: [], lawsuitTypes: [], titles: [], folders: [], courts: [], stakeholderRoles: [], divisionNames: [], numbers: [], users: [], userId, order: '-lastMovement', types: [], instances: [], status: null, tagIds: [], treeView: false, onlyImportant: null, notUpdated: null, isFromContactScreen: false, treeMode: false, historiesMovement: null, createddate: null, shareddate: null, endeddate: null, team: null, ...extra };
}
async function contar(extra) {
  return page.evaluate(async (body) => {
    const http = window.angular.element(document.body).injector().get('$http');
    try { const r = await http.post('https://app.astrea.net.br/api/v2/case-list/count', body); return { count: r.data?.count }; }
    catch (e) { return { erro: `${e.status}: ${JSON.stringify(e.data ?? '').slice(0, 300)}` }; }
  }, { userId, limit: 30, queryCursor: '', queryDTO: dto(extra), currentOrder: '-lastMovement' });
}
const p = (a, b) => ({ fromDate: a, toDate: b });
const linhas = [
  ['sem filtro', {}],
  ['MONTH', { createddate: 'MONTH' }],
  ['TWO_MONTHS', { createddate: 'TWO_MONTHS' }],
  ['THREE_MONTHS', { createddate: 'THREE_MONTHS' }],
  ['MANUAL sem datas', { createddate: 'MANUAL' }],
  ['MANUAL out/2026 (03Z)', { createddate: 'MANUAL', ...p('2026-10-01T03:00:00.000Z', '2026-10-31T03:00:00.000Z') }],
  ['MANUAL out/2026 (fim 23:59:59 SP)', { createddate: 'MANUAL', ...p('2026-10-01T03:00:00.000Z', '2026-11-01T02:59:59.999Z') }],
  ['MANUAL set/2026 (03Z)', { createddate: 'MANUAL', ...p('2026-09-01T03:00:00.000Z', '2026-09-30T03:00:00.000Z') }],
  ['MANUAL set/2026 (fim 23:59:59 SP)', { createddate: 'MANUAL', ...p('2026-09-01T03:00:00.000Z', '2026-10-01T02:59:59.999Z') }],
  ['MANUAL set+out/2026', { createddate: 'MANUAL', ...p('2026-09-01T03:00:00.000Z', '2026-11-01T02:59:59.999Z') }],
  ['MANUAL ms epoch out/2026', { createddate: 'MANUAL', fromDate: Date.parse('2026-10-01T03:00:00Z'), toDate: Date.parse('2026-11-01T02:59:59Z') }],
  ['MANUAL 2000..2100', { createddate: 'MANUAL', ...p('2000-01-01T03:00:00.000Z', '2100-01-01T03:00:00.000Z') }],
  ['MANUAL hoje', { createddate: 'MANUAL', ...p('2026-10-23T03:00:00.000Z', '2026-10-24T02:59:59.999Z') }],
  ['TODAY', { createddate: 'TODAY' }],
];
for (const [nome, extra] of linhas) {
  const r = await contar(extra);
  console.log(`${nome.padEnd(36)} → ${r.erro ? `ERRO ${r.erro}` : r.count}`);
}
await browser.close();
