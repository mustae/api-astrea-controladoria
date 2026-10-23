// Sonda rápida (SEM interação, navegador oculto) com a conta de TESTE do .env (DISC_EMAIL/DISC_PASS):
//  1. descobre o TENANT do escritório (para ASTREA_TENANT_ID no .env);
//  2. descobre como o filtro "data de cadastro" com período funciona em /case-list/count
//     (valores aceitos de queryDTO.createddate) — base de processos_novos_por_mes.
// Só lê; não grava nada no Astrea. Imprime só contagens e ids, nenhum dado de cliente.
//
// Uso (na pasta do projeto):  node scripts/sondar-astrea.mjs

import 'dotenv/config';
import { chromium } from 'playwright';

const EMAIL = process.env.DISC_EMAIL;
const PASS = process.env.DISC_PASS;
if (!EMAIL || !PASS) {
  console.error('Defina DISC_EMAIL e DISC_PASS no .env.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: process.env.SONDA_VISIVEL !== '1' });
const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await context.newPage();

console.log('[login] ...');
await page.goto('https://astrea.net.br/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('input[placeholder*="email" i]', { timeout: 30_000 });
await page.fill('input[placeholder*="email" i]', EMAIL);
await page.fill('input[type="password"]', PASS);
await page.click('button:has-text("ENTRAR")');
await page.waitForFunction(() => location.hash.includes('/main/'), null, { timeout: 90_000 });
await page.waitForFunction(() => !!window.angular?.element(document.body)?.injector()?.get('$http'), null, {
  timeout: 60_000,
});
await page.waitForTimeout(3000);
console.log('[login] OK\n');

// ── 1. Tenant ───────────────────────────────────────────────────────────────
const info = await page.evaluate(() => {
  const root = window.angular.element(document.body).scope()?.$root ?? {};
  const ui = root.userInfo ?? {};
  const achados = {};
  for (const [k, v] of Object.entries(ui)) if (/tenant|office|company|account/i.test(k)) achados[k] = v;
  let userId = String(ui.id ?? '');
  try {
    for (const key of Object.keys(localStorage)) {
      const m = key.match(/case_suggestions_for_user_(\d+)_/);
      if (m) userId = userId || m[1];
      if (/tenant/i.test(key)) achados[`localStorage:${key}`] = localStorage.getItem(key)?.slice(0, 40);
    }
  } catch {}
  return { userId, achados };
});
console.log('== TENANT ==');
console.log('userId:', info.userId);
console.log('campos com tenant/escritório:', JSON.stringify(info.achados, null, 1));

// ── 2. createddate ──────────────────────────────────────────────────────────
const userId = Number(info.userId);
function dto(extra) {
  return {
    contacts: [], lawsuitTypes: [], titles: [], folders: [], courts: [], stakeholderRoles: [],
    divisionNames: [], numbers: [], users: [], userId, order: '-lastMovement', types: [], instances: [],
    status: null, tagIds: [], treeView: false, onlyImportant: null, notUpdated: null,
    isFromContactScreen: false, treeMode: false, historiesMovement: null, createddate: null,
    shareddate: null, endeddate: null, team: null, ...extra,
  };
}
async function contar(extra) {
  return page.evaluate(async (body) => {
    const http = window.angular.element(document.body).injector().get('$http');
    try {
      const r = await http.post('https://app.astrea.net.br/api/v2/case-list/count', body);
      return { count: r.data?.count };
    } catch (e) {
      return { erro: `${e.status}: ${JSON.stringify(e.data ?? '').slice(0, 400)}` };
    }
  }, { userId, limit: 30, queryCursor: '', queryDTO: dto(extra), currentOrder: '-lastMovement' });
}

const OUT = { fromDate: '2026-10-01T03:00:00.000Z', toDate: '2026-10-31T03:00:00.000Z' };
const SET = { fromDate: '2026-09-01T03:00:00.000Z', toDate: '2026-09-30T03:00:00.000Z' };

console.log('\n== createddate ==');
const linhas = [
  ['sem filtro', {}],
  ['MONTH (mês corrente)', { createddate: 'MONTH' }],
  ['valor inválido (erro lista os aceitos?)', { createddate: 'XYZ_INVALIDO' }],
];
for (const v of ['CUSTOM', 'PERSONALIZED', 'PERSONALIZADO', 'PERIOD', 'CUSTOM_PERIOD', 'RANGE', 'INTERVAL', 'BETWEEN', 'SPECIFIC', 'OTHER']) {
  linhas.push([`${v} + out/2026`, { createddate: v, ...OUT }]);
  linhas.push([`${v} + set/2026`, { createddate: v, ...SET }]);
}
for (const v of ['TODAY', 'WEEK', 'LAST_WEEK', 'LAST_MONTH', 'YEAR', 'LAST_YEAR', 'LAST_7_DAYS', 'LAST_30_DAYS']) {
  linhas.push([v, { createddate: v }]);
}
linhas.push(['null + out/2026 (como a UI enviou)', OUT]);
linhas.push(['fromCreatedDate/toCreatedDate out/2026', { fromCreatedDate: OUT.fromDate, toCreatedDate: OUT.toDate }]);
linhas.push(['createdFrom/createdTo out/2026', { createdFrom: OUT.fromDate, createdTo: OUT.toDate }]);

for (const [nome, extra] of linhas) {
  const r = await contar(extra);
  console.log(`${nome.padEnd(42)} → ${r.erro ? `ERRO ${r.erro}` : r.count}`);
}

await browser.close();
console.log('\nPronto. Copie toda a saída para o chat.');
