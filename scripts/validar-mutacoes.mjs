// Validação AO VIVO das tools novas (etiquetas, edição, encerramento, andamento, tarefa)
// contra a API rodando localmente — use SÓ com a conta de TESTE e o processo de teste.
//
// 1) Num terminal:   npm run dev            (sobe a API em http://localhost:3000)
// 2) Noutro terminal: node scripts/validar-mutacoes.mjs <idDoProcessoDeTeste>
//
// Lê API_KEY e PORT do .env. Cada passo desfaz o anterior (remove a etiqueta, apaga o
// andamento e a tarefa, reativa o processo). O valor da condenação e o objeto do processo
// de teste ficam com valores de teste ao final.

import 'dotenv/config';

const PROCESSO = process.argv[2] ?? process.env.TESTE_PROCESSO_ID;
if (!PROCESSO || !/^\d+$/.test(PROCESSO)) {
  console.error('Uso: node scripts/validar-mutacoes.mjs <idDoProcessoDeTeste>');
  process.exit(1);
}
const BASE = `http://localhost:${process.env.PORT ?? 3000}`;
const KEY = process.env.API_KEY;
if (!KEY) {
  console.error('API_KEY ausente no .env');
  process.exit(1);
}

let falhas = 0;
async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}
function checar(nome, cond, extra) {
  console.log(`${cond ? '✅' : '❌'} ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!cond) falhas++;
  return cond;
}
async function caso() {
  const r = await api('GET', `/api/casos/${PROCESSO}`);
  return r.json?.data;
}

const health = await api('GET', '/health');
if (!checar('API no ar', health.status === 200, BASE)) process.exit(1);

// ── Etiquetas ───────────────────────────────────────────────────────────────
const et = await api('GET', '/api/etiquetas?uso=processos');
checar('listar_etiquetas', et.status === 200 && Array.isArray(et.json?.data), `${et.json?.data?.length ?? 0} etiquetas`);
const tag = process.env.TESTE_ETIQUETA_ID
  ? et.json.data.find((e) => e.id === process.env.TESTE_ETIQUETA_ID)
  : et.json?.data?.[0];
if (tag) {
  console.log(`   usando etiqueta "${tag.nome}" (${tag.id})`);
  const ap = await api('POST', '/api/casos/etiquetas', { processoIds: [PROCESSO], etiquetasIds: [tag.id], acao: 'aplicar' });
  checar('etiquetar_processos (aplicar)', ap.status === 200 && ap.json?.data?.sucesso === 1, JSON.stringify(ap.json?.data?.itens ?? ap.json));
  let c = await caso();
  checar('processo mostra a etiqueta', (c?.etiquetas ?? []).includes(tag.nome), JSON.stringify(c?.etiquetas));

  const cnt = await api('GET', `/api/casos/processos/contagem?status=todos&etiquetasIds=${tag.id}`);
  checar('contar_processos filtrando pela etiqueta (valida queryDTO.tagIds)', cnt.json?.data?.total >= 1, `total=${cnt.json?.data?.total}`);
  const lst = await api('GET', `/api/casos/processos?status=todos&etiquetasIds=${tag.id}&limite=200`);
  checar('listar_processos filtrando pela etiqueta', (lst.json?.data ?? []).some((p) => p.id === PROCESSO));

  const rm = await api('POST', '/api/casos/etiquetas', { processoIds: [PROCESSO], etiquetasIds: [tag.id], acao: 'remover' });
  checar('etiquetar_processos (remover)', rm.status === 200 && rm.json?.data?.sucesso === 1);
  c = await caso();
  checar('etiqueta saiu do processo', !(c?.etiquetas ?? []).includes(tag.nome));
} else {
  checar('existe ao menos uma etiqueta para testar', false);
}

// ── Editar ──────────────────────────────────────────────────────────────────
const ed = await api('PATCH', `/api/casos/${PROCESSO}`, { objeto: `Validação ${new Date().toISOString()}`, valorCondenacao: 1234.56 });
checar('editar_processo', ed.status === 200, JSON.stringify(ed.json?.data ?? ed.json));
const c2 = await caso();
checar('valor da condenação gravado', JSON.stringify(c2 ?? {}).includes('1.234,56'));
checar('partes preservadas após edição', (c2?.partes ?? c2?.clientes ?? []).length > 0 || !!c2?.clientePrincipal, 'confira no Astrea se necessário');

// ── Andamento ───────────────────────────────────────────────────────────────
const an = await api('POST', `/api/casos/${PROCESSO}/andamentos`, { descricao: 'Andamento de validação — pode apagar' });
checar('criar_andamento', an.status === 201 && an.json?.data?.id, an.json?.data?.id);
if (an.json?.data?.id) {
  const del = await api('DELETE', `/api/andamentos/${an.json.data.id}`);
  checar('excluir_andamento', del.status === 200);
}

// ── Tarefa ──────────────────────────────────────────────────────────────────
const me = await api('GET', '/api/usuarios/me');
const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const tf = await api('POST', '/api/tarefas', { titulo: 'Tarefa de validação — pode apagar', casoId: PROCESSO, responsavelId: me.json?.data?.id, prazo: amanha });
const tarefaId = tf.json?.data?.id;
checar('criar_tarefa (pré-requisito)', !!tarefaId, tarefaId ?? JSON.stringify(tf.json));
if (tarefaId) {
  const dt = await api('DELETE', `/api/tarefas/${tarefaId}`);
  checar('excluir_tarefa', dt.status === 200, JSON.stringify(dt.json?.data ?? dt.json));
}

// ── Encerrar / reativar ─────────────────────────────────────────────────────
const sem = await api('POST', '/api/casos/encerrar', { processoIds: [PROCESSO] });
checar('encerrar sem confirmar é recusado', sem.status === 400);
const en = await api('POST', '/api/casos/encerrar', { processoIds: [PROCESSO], confirmar: true });
checar('encerrar_processos', en.status === 200 && en.json?.data?.sucesso === 1, JSON.stringify(en.json?.data?.itens ?? en.json));
checar('processo aparece encerrado', (await caso())?.status !== 'Ativo', (await caso())?.status);
const re = await api('POST', `/api/casos/${PROCESSO}/reativar`);
checar('reativar_processo', re.status === 200 && re.json?.data?.reativado === true);
checar('processo voltou a Ativo', (await caso())?.status === 'Ativo');
const re2 = await api('POST', `/api/casos/${PROCESSO}/reativar`);
checar('reativar de novo é no-op (não encerra)', re2.json?.data?.jaEstavaAtivo === true);

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
