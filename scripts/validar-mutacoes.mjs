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
// /api/usuarios/me depende de ASTREA_TENANT_ID correto no .env; sem ele, usa o responsável do processo de teste.
const euId = me.json?.data?.id || (await caso())?.responsavelId;
if (!me.json?.data?.id) console.log(`⚠️  /api/usuarios/me falhou (${me.status}) — confira ASTREA_TENANT_ID no .env. Usando o responsável do processo: ${euId}`);
const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const tf = await api('POST', '/api/tarefas', { titulo: 'Tarefa de validação — pode apagar', casoId: PROCESSO, responsavelId: euId, prazo: amanha });
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


// ── Rodada 2: etiquetas em tarefa/compromisso, prazos, audiências, novos por mês ──
const todas = (await api('GET', '/api/etiquetas')).json?.data ?? [];
const USOS = ['TASKS', 'DEADLINE', 'HEARING', 'APPOINTMENTS'];
const tag2 =
  (process.env.TESTE_ETIQUETA_ID && todas.find((e) => e.id === process.env.TESTE_ETIQUETA_ID)) ||
  todas.find((e) => e.restricoes.length === 0 || USOS.every((u) => e.restricoes.includes(u))) ||
  todas[0];
const eu = euId;
const temTag = (lista) => (lista ?? []).some((e) => String(e.id) === String(tag2?.id));
console.log(`\n   rodada 2 com a etiqueta "${tag2?.nome}" (${tag2?.id})`);

// tarefa com etiqueta na criação + etiquetar_tarefa
const tf2 = await api('POST', '/api/tarefas', { titulo: 'Tarefa c/ etiqueta — pode apagar', casoId: PROCESSO, responsavelId: eu, prazo: amanha, etiquetasIds: [tag2.id] });
const tf2Id = tf2.json?.data?.id;
checar('criar_tarefa com etiquetasIds', !!tf2Id, tf2Id ?? JSON.stringify(tf2.json));
if (tf2Id) {
  const rmT = await api('POST', `/api/tarefas/${tf2Id}/etiquetas`, { etiquetasIds: [tag2.id], acao: 'remover' });
  checar('etiquetar_tarefa (remover)', rmT.status === 200, JSON.stringify(rmT.json?.error ?? ''));
  const apT = await api('POST', `/api/tarefas/${tf2Id}/etiquetas`, { etiquetasIds: [tag2.id], acao: 'aplicar' });
  checar('etiquetar_tarefa (aplicar)', apT.status === 200, JSON.stringify(apT.json?.error ?? ''));
  await api('DELETE', `/api/tarefas/${tf2Id}`);
}

// compromisso com etiqueta
const ev = await api('POST', '/api/agenda/eventos', {
  titulo: 'Compromisso c/ etiqueta — pode apagar', data: amanha, horaInicio: '07:00', responsavelId: eu,
  casoId: PROCESSO, etiquetasIds: [tag2.id], verificarConflito: false,
});
const evId = ev.json?.data?.evento?.id ?? ev.json?.data?.id;
checar('criar_evento_agenda com etiquetasIds', ev.status === 201 && !!evId, evId ?? JSON.stringify(ev.json));
if (evId) {
  const del = await api('DELETE', `/api/agenda/eventos/${evId}?forcar=1`);
  checar('   (compromisso de teste excluído)', del.status === 200);
}

// prazo
const pz = await api('POST', `/api/casos/${PROCESSO}/prazos`, { titulo: 'Prazo de validação — pode apagar', data: amanha, etiquetasIds: [tag2.id] });
const pzId = pz.json?.data?.id;
checar('criar_prazo', pz.status === 201 && !!pzId, pzId ?? JSON.stringify(pz.json));
if (pzId) {
  let b = await api('GET', `/api/prazos/${pzId}`);
  checar('buscar_prazo traz a etiqueta', temTag(b.json?.data?.etiquetas), JSON.stringify(b.json?.data?.etiquetas));
  const depois = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const ed2 = await api('PATCH', `/api/prazos/${pzId}`, { data: depois });
  b = await api('GET', `/api/prazos/${pzId}`);
  checar('editar_prazo (data)', ed2.status === 200 && b.json?.data?.data === depois, b.json?.data?.data);
  checar('editar_prazo preservou a etiqueta', temTag(b.json?.data?.etiquetas));
  await api('POST', `/api/prazos/${pzId}/concluir`, { motivo: 'Validação' });
  checar('concluir_prazo', (await api('GET', `/api/prazos/${pzId}`)).json?.data?.status === 'concluido');
  await api('POST', `/api/prazos/${pzId}/reabrir`);
  checar('reabrir prazo', (await api('GET', `/api/prazos/${pzId}`)).json?.data?.status === 'pendente');
  const dp = await api('DELETE', `/api/prazos/${pzId}`);
  checar('excluir_prazo', dp.status === 200);
}

// audiência
const au = await api('POST', `/api/casos/${PROCESSO}/audiencias`, {
  titulo: 'Audiência de validação — pode apagar', data: amanha, horaInicio: '07:30', forum: 'Fórum Teste', sala: 'Sala 1',
  endereco: 'Rua Teste, 1', etiquetasIds: [tag2.id], verificarConflito: false,
});
const auId = au.json?.data?.id;
checar('criar_audiencia', au.status === 201 && !!auId, auId ?? JSON.stringify(au.json));
if (auId) {
  let b = await api('GET', `/api/audiencias/${auId}`);
  checar('buscar_audiencia (fórum, sala, horário, etiqueta)',
    b.json?.data?.forum === 'Fórum Teste' && b.json?.data?.sala === 'Sala 1' && b.json?.data?.horaFim === '08:00' && temTag(b.json?.data?.etiquetas),
    JSON.stringify(b.json?.data ?? b.json));
  const ea = await api('PATCH', `/api/audiencias/${auId}`, { horaInicio: '08:00', verificarConflito: false });
  b = await api('GET', `/api/audiencias/${auId}`);
  checar('editar_audiencia (remarcar mantendo duração)', ea.status === 200 && b.json?.data?.horaInicio === '08:00' && b.json?.data?.horaFim === '08:30', `${b.json?.data?.horaInicio}-${b.json?.data?.horaFim}`);
  checar('editar_audiencia preservou fórum e etiqueta', b.json?.data?.forum === 'Fórum Teste' && temTag(b.json?.data?.etiquetas));
  const da = await api('DELETE', `/api/audiencias/${auId}`);
  checar('excluir_audiencia', da.status === 200);
}

// processos novos por mês (o processo de teste foi cadastrado neste mês)
const npm = await api('GET', '/api/casos/processos/novos-por-mes?meses=2');
const ultimo = npm.json?.data?.meses?.at(-1);
checar('processos_novos_por_mes', npm.status === 200 && ultimo?.total >= 1, JSON.stringify(npm.json?.data?.meses ?? npm.json));

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
