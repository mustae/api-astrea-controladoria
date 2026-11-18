// Validação AO VIVO: tarefa, prazo, audiência e compromisso criados COM etiqueta e
// incluídos (ou não) na Gestão Kanban, e troca de quadro na edição, contra a API
// rodando localmente. Use SÓ com a conta de TESTE e o processo de teste.
//
// 1) Num terminal:   npm run dev   (sem regras KANBAN_* / ETIQUETA_AUDIENCIA no .env)
// 2) Noutro terminal: node scripts/validar-kanban-etiquetas.mjs <idDoProcessoDeTeste>
//
// Cenários de criação: regra de fábrica (tarefa e prazo → quadro padrão; audiência →
// AUDIENCIAS & PERICIAS com a etiqueta "Audiência"), troca de quadro na chamada,
// compromisso fora por padrão e com pedido explícito, `kanban: false`. Edição: trocar o
// quadro e tirar do Kanban (prazo, audiência, tarefa) e editar tarefa com prazo sem
// perder etiqueta/Kanban. Cada item é conferido no quadro (coluna, etiqueta) e excluído.
// Tipos no quadro: TASK, DEADLINE, HEARING e EVENT (compromisso).

import 'dotenv/config';

const PROCESSO = process.argv[2] ?? process.env.TESTE_PROCESSO_ID;
if (!PROCESSO || !/^\d+$/.test(PROCESSO)) {
  console.error('Uso: node scripts/validar-kanban-etiquetas.mjs <idDoProcessoDeTeste>');
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
const sem = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

if (!checar('API no ar', (await api('GET', '/health')).status === 200, BASE)) process.exit(1);

// ── Quadros, etiquetas, usuário ─────────────────────────────────────────────
const quadros = (await api('GET', '/api/kanban/quadros')).json?.data ?? [];
const padrao = quadros.find((q) => q.padrao);
const audQ = quadros.find((q) => sem(q.nome) === sem('AUDIENCIAS & PERICIAS'));
const outro = quadros.find((q) => !q.padrao && q !== audQ && q.colunas.length > 0);
if (!checar('quadros padrão, AUDIENCIAS & PERICIAS e um terceiro', !!padrao && !!audQ && !!outro, padrao && audQ && outro && `"${padrao.nome}" / "${audQ.nome}" / "${outro.nome}"`)) process.exit(1);

const todas = (await api('GET', '/api/etiquetas')).json?.data ?? [];
const USOS = ['TASKS', 'DEADLINE', 'HEARING', 'APPOINTMENTS'];
const tag =
  (process.env.TESTE_ETIQUETA_ID && todas.find((e) => e.id === process.env.TESTE_ETIQUETA_ID)) ||
  todas.find((e) => e.restricoes.length === 0 || USOS.every((u) => e.restricoes.includes(u)));
if (!checar('etiqueta válida para os 4 tipos', !!tag, tag && `"${tag.nome}" (${tag.id})`)) process.exit(1);
const tagAud = todas.find((e) => sem(e.nome) === 'audiencia');
if (!checar('etiqueta "Audiência" existe', !!tagAud, tagAud?.id)) process.exit(1);

const eu = (await api('GET', '/api/usuarios/me')).json?.data?.id;
if (!checar('usuário da sessão', !!eu, eu)) process.exit(1);

const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const sufixo = Date.now().toString(36);
const primeira = (q) => q.colunas[0];
const no = (q, coluna = primeira(q)) => ({ quadro: q, coluna });

// ── Criação ─────────────────────────────────────────────────────────────────
// esperado: { quadro, coluna } onde deve cair, ou null (fora do Kanban); tags: ids esperados no card
const criados = {};
async function criar(chave, nome, path, body, esperado, excluir, tags = [tag.id]) {
  const r = await api('POST', path, body);
  const data = r.json?.data;
  const id = data?.evento?.id ?? data?.id;
  if (!checar(`${nome}: criado`, (r.status === 201 || r.status === 200) && !!id, id ?? JSON.stringify(r.json))) return;
  const k = data.kanban ?? null;
  checar(
    `${nome}: resposta informa o kanban`,
    esperado ? k?.quadroId === esperado.quadro.id && k?.colunaId === esperado.coluna.id : k === null,
    k ? `${k.quadroNome} > ${k.colunaNome}` : 'fora do Kanban',
  );
  criados[chave] = { nome, id: String(id), esperado, tags, excluir: () => excluir(id) };
}

const tituloDe = (t) => `Kanban ${t} ${sufixo} — pode apagar`;
await criar('tarefa', 'tarefa (regra padrão)', '/api/tarefas',
  { titulo: tituloDe('tarefa'), casoId: PROCESSO, responsavelId: eu, prazo: amanha, etiquetasIds: [tag.id] },
  no(padrao),
  (id) => api('DELETE', `/api/tarefas/${id}`));
await criar('tarefaFora', 'tarefa (kanban: false)', '/api/tarefas',
  { titulo: tituloDe('tarefa-fora'), casoId: PROCESSO, responsavelId: eu, prazo: amanha, etiquetasIds: [tag.id], kanban: false },
  null,
  (id) => api('DELETE', `/api/tarefas/${id}`));
await criar('prazo', 'prazo (regra padrão)', `/api/casos/${PROCESSO}/prazos`,
  { titulo: tituloDe('prazo'), data: amanha, etiquetasIds: [tag.id] },
  no(padrao),
  (id) => api('DELETE', `/api/prazos/${id}`));
await criar('prazoOutro', `prazo (quadro "${outro.nome}" por nome, 1ª coluna)`, `/api/casos/${PROCESSO}/prazos`,
  { titulo: tituloDe('prazo-outro'), data: amanha, etiquetasIds: [tag.id], kanban: { quadro: outro.nome } },
  no(outro),
  (id) => api('DELETE', `/api/prazos/${id}`));
await criar('audiencia', `audiência (regra: "${audQ.nome}" + etiqueta "Audiência")`, `/api/casos/${PROCESSO}/audiencias`,
  { titulo: tituloDe('audiencia'), data: amanha, horaInicio: '06:00', etiquetasIds: [tag.id], verificarConflito: false },
  no(audQ),
  (id) => api('DELETE', `/api/audiencias/${id}`),
  [tag.id, tagAud.id]);
await criar('compromissoFora', 'compromisso (regra: fora)', '/api/agenda/eventos',
  { titulo: tituloDe('compromisso-fora'), data: amanha, horaInicio: '06:30', responsavelId: eu, casoId: PROCESSO, etiquetasIds: [tag.id], verificarConflito: false },
  null,
  (id) => api('DELETE', `/api/agenda/eventos/${id}?forcar=1`));
const col2 = padrao.colunas[1] ?? padrao.colunas[0];
await criar('compromisso', `compromisso (pedido "${padrao.nome} > ${col2.nome}")`, '/api/agenda/eventos',
  { titulo: tituloDe('compromisso'), data: amanha, horaInicio: '07:00', responsavelId: eu, casoId: PROCESSO, etiquetasIds: [tag.id], verificarConflito: false,
    kanban: { quadro: padrao.nome, coluna: col2.nome } },
  no(padrao, col2),
  (id) => api('DELETE', `/api/agenda/eventos/${id}?forcar=1`));

const invalido = await api('POST', `/api/casos/${PROCESSO}/prazos`, { titulo: tituloDe('invalido'), data: amanha, kanban: { quadro: 'Quadro que não existe' } });
checar('quadro inexistente na chamada → 400, nada criado', invalido.status === 400, invalido.json?.error);

// ── Conferência nos quadros ─────────────────────────────────────────────────
async function cardsNosQuadros() {
  const cards = [];
  for (const q of [padrao, audQ, outro]) {
    const lido = await api('GET', `/api/kanban/quadros/${q.id}/atividades?prazoInicio=${amanha}&prazoFim=${amanha}`);
    if (lido.status !== 200) checar(`listar_atividades_kanban "${q.nome}"`, false, String(lido.status));
    for (const c of lido.json?.data?.colunas ?? []) for (const a of c.atividades) cards.push({ ...a, quadroId: q.id, colunaId: c.colunaId });
  }
  return cards;
}
function conferir(cards, c, rotulo = c.nome) {
  const card = cards.find((a) => a.id === c.id);
  if (!c.esperado) {
    checar(`${rotulo}: fora dos quadros`, !card, card ? `achado em ${card.quadroId}` : '');
    return;
  }
  if (!checar(`${rotulo}: aparece no quadro`, !!card, card ? `tipo=${card.tipo}` : '')) return;
  checar(`${rotulo}: quadro e coluna certos`, card.quadroId === c.esperado.quadro.id && card.colunaId === c.esperado.coluna.id, `${card.quadroId} / ${card.colunaId}`);
  const ids = (card.etiquetasIds ?? []).map(String);
  checar(`${rotulo}: com as etiquetas`, c.tags.every((t) => ids.includes(String(t))), JSON.stringify(ids));
}
let cards = await cardsNosQuadros();
for (const c of Object.values(criados)) conferir(cards, c);

// ── Edição: troca de quadro e saída do Kanban ───────────────────────────────
async function editar(chave, nome, path, body, esperado) {
  const c = criados[chave];
  if (!c) return;
  const r = await api('PATCH', path.replace(':id', c.id), body);
  const k = r.json?.data?.kanban;
  const okKanban = !('kanban' in body) || (esperado ? k?.quadroId === esperado.quadro.id && k?.colunaId === esperado.coluna.id : k === null);
  checar(`editar ${nome}`, r.status === 200 && okKanban, r.status === 200 ? (k ? `${k.quadroNome} > ${k.colunaNome}` : k === null ? 'fora do Kanban' : '') : JSON.stringify(r.json));
  c.esperado = esperado;
}
await editar('tarefa', 'tarefa com prazo, só o título (regressão do prazo ISO)', '/api/tarefas/:id', { titulo: tituloDe('tarefa (editada)') }, no(padrao));
cards = await cardsNosQuadros();
conferir(cards, criados.tarefa, 'tarefa editada: mantém Kanban e etiqueta');

await editar('prazo', `prazo → "${audQ.nome}"`, '/api/prazos/:id', { kanban: { quadro: audQ.nome } }, no(audQ));
await editar('prazoOutro', 'prazo → fora do Kanban', '/api/prazos/:id', { kanban: false }, null);
await editar('audiencia', `audiência → "${padrao.nome}"`, '/api/audiencias/:id', { kanban: { quadro: padrao.nome } }, no(padrao));
await editar('tarefa', `tarefa → "${outro.nome}"`, '/api/tarefas/:id', { kanban: { quadro: outro.nome } }, no(outro));
await editar('tarefaFora', `tarefa fora → "${padrao.nome}"`, '/api/tarefas/:id', { kanban: { quadro: padrao.nome } }, no(padrao));
cards = await cardsNosQuadros();
for (const chave of ['prazo', 'prazoOutro', 'audiencia', 'tarefa', 'tarefaFora']) conferir(cards, criados[chave], `${criados[chave].nome} (depois da edição)`);

await editar('tarefa', 'tarefa → fora do Kanban', '/api/tarefas/:id', { kanban: false }, null);
cards = await cardsNosQuadros();
conferir(cards, criados.tarefa, 'tarefa tirada do Kanban');

// ── Limpeza ─────────────────────────────────────────────────────────────────
for (const c of Object.values(criados)) {
  const r = await c.excluir();
  checar(`   (excluído o item de teste: ${c.nome})`, r.status === 200, r.status === 200 ? '' : JSON.stringify(r.json));
}

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
