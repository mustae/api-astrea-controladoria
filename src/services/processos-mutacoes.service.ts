// ─────────────────────────────────────────────────────────────────────────────
// Service: mutações em processos — etiquetas, edição, encerramento/reativação,
// andamento manual e exclusão de tarefa.
//
// Contratos capturados na UI real do Astrea em 21/10/2026
// (scripts/discover-etiquetas-processos.mjs, processo "TESTE DISCOVERY - APAGAR"):
//
//  etiqueta aplicar  GET  /_ah/api/folders/v1/addTagToCase?caseId&tagId&userId      → 204
//  etiqueta remover  GET  /_ah/api/folders/v1/removeTagFromCase?caseId&tagId&userId → 204
//  (lote na UI)      POST /api/v2/batch-action/enqueue {subType: CASE_TAG_ADD|REMOVE}
//                    → assíncrono (firebaseToken); NÃO usado aqui: preferimos a chamada
//                      síncrona por processo, que dá resultado verificável por item.
//  editar processo   GET  /_ah/api/folders/v1/getCaseById → POST /_ah/api/folders/v1/saveLawsuit
//                    (mesmo read-modify-write de vincularClienteCaso, já em produção)
//  encerrar          POST /api/v2/folder/inactivate
//  reativar          PUT  /api/v2/case/toggle-activate-inactivate-case  (é TOGGLE!)
//  andamento criar   POST /_ah/api/histories/v1/saveHistoricalByCase
//  andamento excluir DELETE /api/v2/historical/{id}
//  tarefa excluir    POST /_ah/api/workspace/v1/getTaskWithComments → POST .../deleteTask
//                    (vai para a lixeira do Astrea: idTrashCan)
//
// Operações em lote rodam em SÉRIE numa única aba (conta do escritório tem detecção de
// uso indevido — ver CLAUDE.md) e nunca lançam no meio: cada item reporta ok/erro.
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  ANGULAR_PAGE_PATH,
  astreaApiDelete,
  astreaApiPost,
  astreaApiPut,
  astreaGapiGet,
  astreaGapiPost,
  getAstreaUserId,
  withBrowserContext,
} from '../browser/astrea-http.js';
import { navigateTo } from '../browser/navigator.js';
import { isRetryablePlaywrightError } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { normalizarIdsNumericos } from './casos-query.js';
import type { ServiceError, ServiceResponse } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Limites e helpers
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_PROCESSOS_LOTE = 200;
export const MAX_ETIQUETAS_LOTE = 20;
/** Acima disso, operações de etiqueta exigem `confirmar: true`. */
export const LIMIAR_CONFIRMACAO_ETIQUETA = 10;

const TZ = 'America/Sao_Paulo';

function erro(code: ServiceError['code'], message: string, retryable = false): ServiceResponse<never> {
  return { ok: false, error: { code, message, retryable } };
}

function classificar(err: unknown, onde: string): ServiceResponse<never> {
  logger.error({ err }, `Erro em ${onde}`);
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith('VALIDATION_ERROR')) return erro('VALIDATION_ERROR', msg.replace(/^VALIDATION_ERROR:\s*/, ''));
  if (msg.startsWith('NOT_FOUND') || msg.includes('API_ERROR_404')) {
    return erro('NOT_FOUND', msg.replace(/^NOT_FOUND:\s*/, ''));
  }
  if (msg.includes('API_ERROR_403')) return erro('FORBIDDEN', msg);
  if (msg.startsWith('SESSION_EXPIRED')) return erro('SESSION_EXPIRED', msg, true);
  if (/timeout/i.test(msg)) return erro('TIMEOUT', msg, true);
  return erro('API_ERROR', msg, isRetryablePlaywrightError(err));
}

/** Valida e normaliza uma lista de IDs (string), mantendo o texto original. */
function idsValidos(ids: readonly string[] | undefined, campo: string, max: number): string[] {
  const nums = normalizarIdsNumericos(ids, campo);
  if (!nums.length) throw new Error(`VALIDATION_ERROR: informe ao menos um ${campo}`);
  if (nums.length > max) throw new Error(`VALIDATION_ERROR: máximo de ${max} ${campo}s por chamada`);
  return nums.map(String);
}

function idUnico(id: string, campo = 'id'): string {
  return idsValidos([id], campo, 1)[0];
}

async function abrir(page: Page): Promise<string> {
  await navigateTo(page, ANGULAR_PAGE_PATH);
  return getAstreaUserId(page);
}

export interface ItemLote {
  processoId: string;
  ok: boolean;
  erro?: string;
}

export interface ResultadoLote {
  total: number;
  sucesso: number;
  falhas: number;
  itens: ItemLote[];
}

async function emSerie(ids: string[], acao: (id: string) => Promise<void>): Promise<ResultadoLote> {
  const itens: ItemLote[] = [];
  for (const id of ids) {
    try {
      await acao(id);
      itens.push({ processoId: id, ok: true });
    } catch (err) {
      itens.push({ processoId: id, ok: false, erro: err instanceof Error ? err.message : String(err) });
    }
  }
  const sucesso = itens.filter((i) => i.ok).length;
  return { total: itens.length, sucesso, falhas: itens.length - sucesso, itens };
}

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas
// ─────────────────────────────────────────────────────────────────────────────

export interface EtiquetarInput {
  processoIds: string[];
  etiquetasIds: string[];
  acao: 'aplicar' | 'remover';
  /** Obrigatório acima de 10 processos. */
  confirmar?: boolean;
}

export async function etiquetarProcessos(
  input: EtiquetarInput,
): Promise<ServiceResponse<ResultadoLote & { acao: EtiquetarInput['acao'] }>> {
  try {
    const processos = idsValidos(input.processoIds, 'processoId', MAX_PROCESSOS_LOTE);
    const etiquetas = idsValidos(input.etiquetasIds, 'etiquetaId', MAX_ETIQUETAS_LOTE);
    if (processos.length > LIMIAR_CONFIRMACAO_ETIQUETA && input.confirmar !== true) {
      throw new Error(
        `VALIDATION_ERROR: operação em ${processos.length} processos — reenvie com confirmar=true`,
      );
    }
    const metodo = input.acao === 'remover' ? 'removeTagFromCase' : 'addTagToCase';

    const resultado = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      return emSerie(processos, async (caseId) => {
        for (const tagId of etiquetas) {
          await astreaGapiGet(
            page,
            `/folders/v1/${metodo}?caseId=${caseId}&tagId=${tagId}&userId=${encodeURIComponent(userId)}`,
          );
        }
      });
    });

    logger.info({ acao: input.acao, ...resultado, itens: undefined }, 'etiquetarProcessos: OK');
    return { ok: true, data: { acao: input.acao, ...resultado } };
  } catch (err) {
    return classificar(err, 'etiquetarProcessos');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Editar processo (read-modify-write)
// ─────────────────────────────────────────────────────────────────────────────

export interface EditarProcessoInput {
  /** Objeto do processo (campo `description` no Astrea). */
  objeto?: string;
  /** Valor da condenação (`convictionAmount`). */
  valorCondenacao?: number;
  titulo?: string;
}

interface CaseByIdPayload {
  id?: string | number;
  caseType?: string;
  status?: string;
  [key: string]: unknown;
}

async function lerCaso(page: Page, id: string, userId: string): Promise<CaseByIdPayload> {
  try {
    return await astreaGapiGet<CaseByIdPayload>(
      page,
      `/folders/v1/getCaseById?id=${id}&userId=${encodeURIComponent(userId)}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('API_ERROR_404')) {
      throw new Error(`NOT_FOUND: processo ${id} não encontrado`);
    }
    throw err;
  }
}

export async function editarProcesso(
  id: string,
  input: EditarProcessoInput,
): Promise<ServiceResponse<{ id: string; alterados: string[] }>> {
  try {
    const caseId = idUnico(id, 'processoId');
    const alterados = (['objeto', 'valorCondenacao', 'titulo'] as const).filter((k) => input[k] !== undefined);
    if (!alterados.length) {
      throw new Error('VALIDATION_ERROR: informe ao menos um campo (objeto, valorCondenacao, titulo)');
    }
    if (input.titulo !== undefined && !input.titulo.trim()) {
      throw new Error('VALIDATION_ERROR: título não pode ser vazio');
    }

    const salvoId = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      const base = await lerCaso(page, caseId, userId);

      if (!String(base.caseType ?? '').toUpperCase().includes('LAWSUIT')) {
        // saveCase (casos extrajudiciais) tem formulário diferente — ainda não capturado.
        throw new Error('VALIDATION_ERROR: edição suportada apenas para processos judiciais (CTE_LAWSUIT)');
      }

      const payload: Record<string, unknown> = { ...base, userId };
      if (input.objeto !== undefined) payload.description = input.objeto;
      if (input.valorCondenacao !== undefined) payload.convictionAmount = input.valorCondenacao;
      if (input.titulo !== undefined) payload.title = input.titulo.trim();

      const resp = await astreaGapiPost<{ response?: { id?: string }; folder?: { id?: string } }>(
        page,
        `/folders/v1/saveLawsuit?userId=${encodeURIComponent(userId)}&alt=json`,
        payload,
      );
      return String(resp?.folder?.id ?? resp?.response?.id ?? caseId);
    });

    logger.info({ id: salvoId, alterados }, 'editarProcesso: OK');
    return { ok: true, data: { id: salvoId, alterados } };
  } catch (err) {
    return classificar(err, 'editarProcesso');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Encerrar / reativar
// ─────────────────────────────────────────────────────────────────────────────

export interface EncerrarInput {
  processoIds: string[];
  valorCondenacao?: number;
  /** Desvincula do acompanhamento automático do tribunal. Default false. */
  desvincularTribunal?: boolean;
  /** Obrigatório (sempre). */
  confirmar?: boolean;
}

export async function encerrarProcessos(input: EncerrarInput): Promise<ServiceResponse<ResultadoLote>> {
  try {
    const processos = idsValidos(input.processoIds, 'processoId', MAX_PROCESSOS_LOTE);
    if (input.confirmar !== true) {
      throw new Error(`VALIDATION_ERROR: encerrar ${processos.length} processo(s) exige confirmar=true`);
    }

    const resultado = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      return emSerie(processos, async (caseId) => {
        await astreaApiPost(page, '/folder/inactivate', {
          caseId: Number(caseId),
          unlink: input.desvincularTribunal === true,
          userId,
          isFromMainCase: true,
          judgments: 'DOESNT_APPLY',
          convictionAmount: input.valorCondenacao ?? null,
          judgmentsOutcome: null,
        });
      });
    });

    logger.info({ ...resultado, itens: undefined }, 'encerrarProcessos: OK');
    return { ok: true, data: resultado };
  } catch (err) {
    return classificar(err, 'encerrarProcessos');
  }
}

export async function reativarProcesso(
  id: string,
): Promise<ServiceResponse<{ id: string; reativado: boolean; jaEstavaAtivo?: true }>> {
  try {
    const caseId = idUnico(id, 'processoId');
    const data = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      // O endpoint é um TOGGLE: chamá-lo num processo ativo o ENCERRARIA.
      const atual = await lerCaso(page, caseId, userId);
      if (String(atual.status ?? '').toLowerCase() === 'active') {
        return { id: caseId, reativado: false, jaEstavaAtivo: true as const };
      }
      await astreaApiPut(page, '/case/toggle-activate-inactivate-case', {
        caseId: Number(caseId),
        unlink: false,
        isFromMainCase: true,
        userId,
      });
      return { id: caseId, reativado: true };
    });
    return { ok: true, data };
  } catch (err) {
    return classificar(err, 'reativarProcesso');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Andamento manual
// ─────────────────────────────────────────────────────────────────────────────

export interface CriarAndamentoInput {
  processoId: string;
  descricao: string;
  /** `YYYY-MM-DD` (meio-dia em SP) ou ISO completo. Default: agora. */
  data?: string;
  /** Default: usuário da sessão. */
  responsavelId?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function partesSP(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

function resolverData(data: string | undefined, agora: Date): Date {
  if (!data) return agora;
  if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    // Brasil sem horário de verão desde 2019: SP = UTC-3.
    return new Date(`${data}T12:00:00.000-03:00`);
  }
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) throw new Error(`VALIDATION_ERROR: data inválida: ${data}`);
  return d;
}

export function montarAndamentoPayload(
  input: CriarAndamentoInput,
  userId: string,
  agora: Date = new Date(),
): Record<string, unknown> {
  const quando = resolverData(input.data, agora);
  const p = partesSP(quando);
  const html = input.descricao
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('');
  return {
    date: quando.toISOString(),
    historicalTime: `${p.hour}:${p.minute}`,
    description: html,
    responsible: input.responsavelId ?? userId,
    historicalParentId: null,
    caseId: Number(input.processoId),
    rootCaseId: null,
    clippingId: null,
    type: 'MANUALLY',
    tagIds: [],
    id: null,
    dateStr: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,
    userId,
  };
}

export async function criarAndamento(
  input: CriarAndamentoInput,
): Promise<ServiceResponse<{ id: string; processoId: string; data?: string; descricao: string }>> {
  try {
    const processoId = idUnico(input.processoId, 'processoId');
    if (!input.descricao?.trim()) throw new Error('VALIDATION_ERROR: descrição obrigatória');
    if (input.responsavelId) idUnico(input.responsavelId, 'responsavelId');
    resolverData(input.data, new Date()); // valida antes de abrir aba

    const resp = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      return astreaGapiPost<{ id?: string; date?: string }>(
        page,
        '/histories/v1/saveHistoricalByCase',
        montarAndamentoPayload({ ...input, processoId }, userId),
      );
    });
    if (!resp?.id) throw new Error('API_ERROR: Astrea não retornou o id do andamento');

    return {
      ok: true,
      data: { id: String(resp.id), processoId, data: resp.date, descricao: input.descricao.trim() },
    };
  } catch (err) {
    return classificar(err, 'criarAndamento');
  }
}

export async function excluirAndamento(id: string): Promise<ServiceResponse<{ id: string; removido: true }>> {
  try {
    const hid = idUnico(id, 'andamentoId');
    await withBrowserContext(async (page) => {
      await abrir(page);
      await astreaApiDelete(page, `/historical/${hid}`);
    });
    return { ok: true, data: { id: hid, removido: true } };
  } catch (err) {
    return classificar(err, 'excluirAndamento');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Excluir tarefa
// ─────────────────────────────────────────────────────────────────────────────

export async function excluirTarefa(
  id: string,
): Promise<ServiceResponse<{ id: string; removido: true; lixeiraId?: string }>> {
  try {
    const taskId = idUnico(id, 'tarefaId');
    const resp = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      const atual = await astreaGapiPost<{ version?: number; dueDate?: string }>(
        page,
        '/workspace/v1/getTaskWithComments',
        { taskId: Number(taskId), userId, bringAllComments: false },
      );
      if (atual?.version === undefined || atual?.version === null) {
        throw new Error(`API_ERROR: tarefa ${taskId} sem version (não encontrada?)`);
      }
      return astreaGapiPost<{ idTrashCan?: string }>(page, '/workspace/v1/deleteTask', {
        taskId,
        taskVersion: atual.version,
        taskListId: null,
        userId,
        date: atual.dueDate ?? null,
      });
    });
    return {
      ok: true,
      data: { id: taskId, removido: true, lixeiraId: resp?.idTrashCan ? String(resp.idTrashCan) : undefined },
    };
  } catch (err) {
    return classificar(err, 'excluirTarefa');
  }
}
