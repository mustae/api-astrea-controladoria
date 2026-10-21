// Discovery GUIADO: endpoints internos do Astrea para etiquetas, edição/encerramento
// de processo, andamento manual e exclusão de tarefa (paridade com o mcp.ai/astrea).
//
// ⚠️  ATENÇÃO — leia antes de rodar
//   • O Astrea mantém UMA sessão por usuário: logar aqui DERRUBA a sessão da api em
//     produção se for a mesma conta. Rode FORA DO EXPEDIENTE (ou com outro usuário).
//   • Use um PROCESSO DE TESTE (crie um "TESTE DISCOVERY - APAGAR" antes) — o roteiro
//     aplica etiqueta, edita, encerra e reativa, cria e apaga andamento/tarefa.
//
// Uso (PowerShell, na raiz do projeto):
//   $env:DISC_EMAIL='usuario@escritorio'; $env:DISC_PASS='senha'; node scripts/discover-etiquetas-processos.mjs
// Uso (bash):
//   DISC_EMAIL='...' DISC_PASS='...' node scripts/discover-etiquetas-processos.mjs
//
// Como funciona: o browser abre visível e faz login. Para cada etapa, o terminal
// mostra o que fazer na tela; você faz a ação no Astrea e aperta ENTER no terminal.
// Tudo que for para app.astrea.net.br/api|_ah é gravado com a etapa como rótulo.
// Digite "p" + ENTER para pular uma etapa (ex.: se a UI não tiver ação em lote).
//
// Saída: scripts/discovery-output/etiquetas-processos-<timestamp>.json
//        (+ resumo impresso no final). NÃO contém senha nem token: o login não é
//        gravado e cabeçalhos Authorization não são salvos.
// Envie o JSON para quem for implementar (ou cole no chat com o Claude).

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const EMAIL = process.env.DISC_EMAIL;
const PASS = process.env.DISC_PASS;
if (!EMAIL || !PASS) {
  console.error('FALTAM credenciais. Defina DISC_EMAIL e DISC_PASS.');
  process.exit(1);
}

const ETAPAS = [
  {
    id: 'etiqueta-aplicar',
    instrucao: 'Abra o PROCESSO DE TESTE e ADICIONE uma etiqueta a ele (salve).',
  },
  {
    id: 'etiqueta-remover',
    instrucao: 'No mesmo processo, REMOVA a etiqueta que acabou de adicionar (salve).',
  },
  {
    id: 'etiqueta-lote',
    instrucao:
      'Na LISTA de "Processos e casos", marque 2 processos de teste e use a ação em lote de ETIQUETAR (se existir). Depois remova em lote.',
  },
  {
    id: 'processo-editar',
    instrucao:
      'Abra o processo de teste → Editar. Mude o OBJETO e o VALOR DA CONDENAÇÃO e SALVE.',
  },
  {
    id: 'processo-encerrar',
    instrucao: 'No processo de teste, use ENCERRAR (informe valor/opções se pedir) e confirme.',
  },
  {
    id: 'processo-reativar',
    instrucao: 'Reative/reabra o processo de teste (desfaz a etapa anterior).',
  },
  {
    id: 'andamento-criar',
    instrucao: 'No processo de teste, aba Histórico/Andamentos → crie um ANDAMENTO MANUAL com data.',
  },
  {
    id: 'andamento-excluir',
    instrucao: 'Exclua o andamento manual que acabou de criar.',
  },
  {
    id: 'tarefa-criar',
    instrucao: 'No processo de teste, crie uma TAREFA (com prazo e responsável).',
  },
  {
    id: 'tarefa-excluir',
    instrucao: 'Exclua a tarefa que acabou de criar.',
  },
  {
    id: 'filtro-data-cadastro',
    instrucao:
      'Na LISTA de "Processos e casos", aplique o filtro por DATA DE CADASTRO/CRIAÇÃO (ex.: este mês). Serve para "processos novos por mês".',
  },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'discovery-output');
mkdirSync(OUT_DIR, { recursive: true });
const OUT_FILE = join(OUT_DIR, `etiquetas-processos-${Date.now()}.json`);

const IGNORAR = ['/firebase', '/banner-login', '/discovery/v1', '/feature-toggle/', '/has-active'];
function deveCapturar(url) {
  if (!url.includes('app.astrea.net.br')) return false;
  if (!url.includes('/api/') && !url.includes('/_ah/')) return false;
  return !IGNORAR.some((p) => url.includes(p));
}

const captured = [];
const pendentes = new Map();
let etapa = 'login';

function anexar(pg, rotulo) {
  pg.on('request', (req) => {
    if (etapa === 'login') return; // nunca grava o login
    const url = req.url();
    if (!deveCapturar(url)) return;
    const entry = {
      id: captured.length,
      etapa,
      aba: rotulo,
      method: req.method(),
      url,
      postData: req.postData()?.slice(0, 8000),
      ts: new Date().toISOString(),
    };
    captured.push(entry);
    pendentes.set(req, entry);
  });
  pg.on('response', async (resp) => {
    const entry = pendentes.get(resp.request());
    if (!entry) return;
    pendentes.delete(resp.request());
    entry.status = resp.status();
    try {
      const body = await resp.text();
      entry.responseBody = body.slice(0, 6000);
      entry.responseBytes = body.length;
    } catch (err) {
      entry.responseError = String(err);
    }
  });
}

const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
const context = await browser.newContext({ viewport: null, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await context.newPage();
anexar(page, 'tab-1');
context.on('page', (p) => {
  const rotulo = `tab-${context.pages().length}`;
  console.log(`\n[nova aba] ${rotulo}`);
  anexar(p, rotulo);
});

console.log('[login] abrindo Astrea...');
await page.goto('https://astrea.net.br/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('input[placeholder*="email" i]', { timeout: 30_000 });
await page.fill('input[placeholder*="email" i]', EMAIL);
await page.fill('input[type="password"]', PASS);
await page.click('button:has-text("ENTRAR")');
await page.waitForFunction(() => location.hash.includes('/main/'), null, { timeout: 90_000 });
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
console.log('[login] OK.\n');

const rl = readline.createInterface({ input: stdin, output: stdout });
etapa = 'navegacao-livre';
await rl.question('Navegue até o PROCESSO DE TESTE e aperte ENTER para começar o roteiro... ');

const puladas = [];
for (const [i, e] of ETAPAS.entries()) {
  etapa = e.id;
  const antes = captured.length;
  console.log(`\n── Etapa ${i + 1}/${ETAPAS.length}: ${e.id}`);
  console.log(`   ${e.instrucao}`);
  const resp = await rl.question('   Feito? ENTER para seguir (p = pular): ');
  // pequena folga para respostas atrasadas
  await new Promise((r) => setTimeout(r, 1500));
  const n = captured.length - antes;
  if (resp.trim().toLowerCase() === 'p') puladas.push(e.id);
  console.log(`   ✓ ${n} requisições gravadas nesta etapa`);
  etapa = `pos-${e.id}`;
}
rl.close();

const MUTACAO = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const resumo = {};
for (const c of captured) {
  if (c.etapa.startsWith('pos-')) continue;
  const path = c.url.replace(/^https:\/\/app\.astrea\.net\.br/, '').split('?')[0];
  const chave = `${c.method} ${path} → ${c.status ?? '?'}`;
  (resumo[c.etapa] ??= new Set()).add(chave);
}

writeFileSync(
  OUT_FILE,
  JSON.stringify(
    {
      meta: { capturedAt: new Date().toISOString(), total: captured.length, puladas, etapas: ETAPAS },
      resumo: Object.fromEntries(Object.entries(resumo).map(([k, v]) => [k, [...v]])),
      requests: captured,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('\n================ RESUMO (mutações destacadas com *) ================');
for (const [k, v] of Object.entries(resumo)) {
  console.log(`\n[${k}]`);
  for (const linha of v) console.log(`  ${MUTACAO.has(linha.split(' ')[0]) ? '*' : ' '} ${linha}`);
}
console.log(`\nArquivo: ${OUT_FILE}`);
console.log('Fechando o browser em 5 s...');
await new Promise((r) => setTimeout(r, 5000));
await browser.close();
