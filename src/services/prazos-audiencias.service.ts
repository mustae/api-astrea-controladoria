// ─────────────────────────────────────────────────────────────────────────────
// Service: PRAZOS (deadlines) e AUDIÊNCIAS (hearings) vinculados a processos.
//
// Contratos capturados na UI real do Astrea em 21/10/2026 (rodada 2 do
// scripts/discover-etiquetas-processos.mjs, processo "TESTE DISCOVERY - APAGAR"):
//
//  prazo criar/editar   POST /api/v2/deadlines/save            → { response: <id> }
//  prazo carregar       GET  /api/v2/deadlines/{id}
//  prazo status         POST /api/v2/deadlines/update-status   {deadlineId, userId, status: DONE|IN_PROGRESS, reason?} → 204
//  prazo excluir        POST /api/v2/deadlines/{id}/delete     {}
//  audiência criar/ed.  POST /api/v2/hearings/save             → { response: <id> }
//  audiência carregar   GET  /api/v2/hearings/{id}
//  audiência excluir    POST /api/v2/hearings/{id}/delete      {}
//  conflito de agenda   POST /api/v2/calendar-pro/calendar-conflicts
//                       {activityId|null, start:"YYYY-MM-DD HH:mm", end, userId, responsibleId} → []
//
// Edição = read-modify-write: o corpo do save na edição é o DTO do GET com os campos
// alterados + alguns extras do formulário (userId, notify, kanbanId/ColumnId...).
// Campos de kanban são OMITIDOS na criação (a UI escolhe o quadro padrão; sem eles o
// Astrea cria fora do kanban, como já fazemos em tarefas).
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import {
  ANGULAR_PAGE_PATH,
  astreaApiGet,
  astreaApiPost,
  getAstreaUserId,
  withBrowserContext,
} from '../browser/astrea-http.js';
import { navigateTo } from '../browser/navigator.js';
import { isRetryablePlaywrightError } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { normalizarIdsNumericos } from './casos-query.js';
import { listarUsuarios } from './usuarios.service.js';
import type { ServiceError, ServiceResponse } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DURACAO_PADRAO_MIN = 30;

class ConflitoError extends Error {
  constructor(public readonly conflitos: unknown[]) {
    super('CONFLICT: o responsável já tem compromisso nesse horário');
  }
}

function falha(err: unknown, onde: string): ServiceResponse<never> {
  logger.error({ err }, `Erro em ${onde}`);
  const msg = err instanceof Error ? err.message : String(err);
  const sem = (p: string) => msg.replace(new RegExp(`^${p}:\\s*`), '');
  let error: ServiceError;
  if (err instanceof ConflitoError) {
    error = { code: 'CONFLICT', message: sem('CONFLICT'), retryable: false, details: { conflitos: err.conflitos } };
  } else if (msg.startsWith('VALIDATION_ERROR')) {
    error = { code: 'VALIDATION_ERROR', message: sem('VALIDATION_ERROR'), retryable: false };
  } else if (msg.includes('API_ERROR_404') || msg.includes('API_ERROR_410')) {
    error = { code: 'NOT_FOUND', message: msg, retryable: false };
  } else if (msg.includes('API_ERROR_403')) {
    error = { code: 'FORBIDDEN', message: msg, retryable: false };
  } else if (msg.startsWith('SESSION_EXPIRED')) {
    error = { code: 'SESSION_EXPIRED', message: msg, retryable: true };
  } else if (/timeout/i.test(msg)) {
    error = { code: 'TIMEOUT', message: msg, retryable: true };
  } else {
    error = { code: 'API_ERROR', message: msg, retryable: isRetryablePlaywrightError(err) };
  }
  return { ok: false, error };
}

function validar(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`VALIDATION_ERROR: ${msg}`);
}

function dataValida(s: string | undefined): s is string {
  if (!s || !RE_DATA.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function idUnico(id: string | undefined, campo: string): string {
  const ids = normalizarIdsNumericos(id ? [id] : [], campo);
  validar(ids.length === 1, `${campo} obrigatório`);
  return String(ids[0]);
}

function etiquetas(ids: string[] | undefined): string[] | undefined {
  return ids === undefined ? undefined : normalizarIdsNumericos(ids, 'etiquetaId').map(String);
}

function somarMin(hora: string, min: number): string {
  const [h, m] = hora.split(':').map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function statusLegivel(s: unknown): 'pendente' | 'concluido' | 'cancelado' | string {
  const v = String(s ?? '').toUpperCase();
  if (v === 'DONE') return 'concluido';
  if (v === 'IN_PROGRESS') return 'pendente';
  if (v === 'CANCELED') return 'cancelado';
  return String(s ?? '');
}

function mapEtiquetas(tagDtos: unknown): Array<{ id: string; nome: string }> {
  return Array.isArray(tagDtos)
    ? tagDtos.map((t: { id?: unknown; label?: unknown }) => ({ id: String(t.id), nome: String(t.label ?? '') }))
    : [];
}

/** Extras de kanban que a UI reenvia na edição (strings, a partir de kanbanDetails). */
function kanbanDaEdicao(atual: Record<string, unknown>): Record<string, unknown> {
  const k = atual.kanbanDetails as { id?: unknown; columnId?: unknown } | null | undefined;
  if (!k || k.id == null) return {};
  return {
    kanbanId: String(k.id),
    kanbanColumnId: k.columnId == null ? null : String(k.columnId),
    kanbanDetails: { id: String(k.id), columnId: k.columnId == null ? null : String(k.columnId) },
  };
}

async function abrir(page: Page): Promise<string> {
  await navigateTo(page, ANGULAR_PAGE_PATH);
  return getAstreaUserId(page);
}

async function nomeDoUsuario(id: string): Promise<string> {
  try {
    const r = await listarUsuarios();
    return (r.ok && r.data.find((u) => u.id === id)?.nome) || '';
  } catch {
    return '';
  }
}

function idDaResposta(resp: unknown, fallback?: string): string {
  const r = resp as { response?: unknown; id?: unknown } | undefined;
  const id = r?.response ?? r?.id ?? fallback;
  if (id === undefined || id === null || id === '') throw new Error('API_ERROR: o Astrea não retornou o id');
  return String(id);
}

async function checarConflito(
  page: Page,
  userId: string,
  responsavelId: string,
  data: string,
  horaInicio: string,
  horaFim: string,
  activityId: number | null,
): Promise<void> {
  const conflitos = await astreaApiPost<unknown[]>(page, '/calendar-pro/calendar-conflicts', {
    activityId,
    start: `${data} ${horaInicio}`,
    end: `${data} ${horaFim}`,
    userId,
    responsibleId: responsavelId,
  });
  if (Array.isArray(conflitos) && conflitos.length > 0) throw new ConflitoError(conflitos);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRAZOS
// ─────────────────────────────────────────────────────────────────────────────

export interface CriarPrazoInput {
  processoId: string;
  titulo: string;
  /** Data fatal, YYYY-MM-DD. */
  data: string;
  /** Default: usuário da sessão. */
  responsavelId?: string;
  etiquetasIds?: string[];
  observacoes?: string;
}

export interface EditarPrazoInput {
  titulo?: string;
  data?: string;
  responsavelId?: string;
  etiquetasIds?: string[];
  observacoes?: string;
}

export interface Prazo {
  id: string;
  titulo: string;
  data: string;
  status: string;
  processoId?: string;
  processoTitulo?: string;
  responsavelId?: string;
  responsavelNome?: string;
  etiquetas: Array<{ id: string; nome: string }>;
  observacoes?: string;
}

export async function criarPrazo(
  input: CriarPrazoInput,
): Promise<ServiceResponse<{ id: string; processoId: string; titulo: string; data: string }>> {
  try {
    const processoId = idUnico(input.processoId, 'processoId');
    const titulo = input.titulo?.trim();
    validar(titulo, 'titulo obrigatório');
    validar(dataValida(input.data), 'data deve ser YYYY-MM-DD');
    const tagIds = etiquetas(input.etiquetasIds) ?? [];
    const respInformado = input.responsavelId ? idUnico(input.responsavelId, 'responsavelId') : undefined;

    const id = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      const responsavelId = respInformado ?? userId;
      const resp = await astreaApiPost(page, '/deadlines/save', {
        name: titulo,
        dueDate: input.data,
        responsibleId: responsavelId,
        responsibleName: await nomeDoUsuario(responsavelId),
        alertNumTimeUnit: '',
        alertTimeUnit: 'TUE_DAYS',
        secondAlertTimeUnit: '',
        status: 'IN_PROGRESS',
        allDay: true,
        rootCaseId: null,
        caseId: Number(processoId),
        historicalId: null,
        deadlineDays: 'workingDays',
        quantity: null,
        parentType: null,
        tagIds,
        comments: input.observacoes?.trim() ?? '',
        parentId: null,
        userId,
        ownerId: userId,
        notify: false,
      });
      return idDaResposta(resp);
    });

    logger.info({ id, processoId }, 'criarPrazo: OK');
    return { ok: true, data: { id, processoId, titulo, data: input.data } };
  } catch (err) {
    return falha(err, 'criarPrazo');
  }
}

export async function editarPrazo(
  id: string,
  input: EditarPrazoInput,
): Promise<ServiceResponse<{ id: string; alterados: string[] }>> {
  try {
    const prazoId = idUnico(id, 'prazoId');
    const alterados = (['titulo', 'data', 'responsavelId', 'etiquetasIds', 'observacoes'] as const).filter(
      (k) => input[k] !== undefined,
    );
    validar(alterados.length, 'informe ao menos um campo para alterar');
    if (input.titulo !== undefined) validar(input.titulo.trim(), 'titulo não pode ser vazio');
    if (input.data !== undefined) validar(dataValida(input.data), 'data deve ser YYYY-MM-DD');
    const tagIds = etiquetas(input.etiquetasIds);
    const resp = input.responsavelId ? idUnico(input.responsavelId, 'responsavelId') : undefined;

    const salvo = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      const atual = await astreaApiGet<Record<string, unknown>>(page, `/deadlines/${prazoId}`);
      const body: Record<string, unknown> = {
        ...atual,
        userId,
        rootCaseId: atual.rootCaseId ?? null,
        deadlineDays: atual.deadlineDays ?? 'workingDays',
        alertNumTimeUnit: atual.alertNumTimeUnit ?? '',
        ...kanbanDaEdicao(atual),
        notify: false,
      };
      if (input.titulo !== undefined) body.name = input.titulo.trim();
      if (input.data !== undefined) body.dueDate = input.data;
      if (input.observacoes !== undefined) body.comments = input.observacoes;
      if (resp) {
        body.responsibleId = resp;
        body.responsibleName = await nomeDoUsuario(resp);
      }
      if (tagIds !== undefined) {
        body.tagIds = tagIds;
        delete body.tagDtos;
      }
      return idDaResposta(await astreaApiPost(page, '/deadlines/save', body), prazoId);
    });

    return { ok: true, data: { id: salvo, alterados } };
  } catch (err) {
    return falha(err, 'editarPrazo');
  }
}

export async function alterarStatusPrazo(
  id: string,
  input: { concluido: boolean; motivo?: string },
): Promise<ServiceResponse<{ id: string; status: 'concluido' | 'pendente' }>> {
  try {
    const prazoId = idUnico(id, 'prazoId');
    await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      await astreaApiPost(page, '/deadlines/update-status', {
        deadlineId: Number(prazoId),
        ...(input.concluido && input.motivo?.trim() ? { reason: input.motivo.trim() } : {}),
        userId,
        status: input.concluido ? 'DONE' : 'IN_PROGRESS',
      });
    });
    return { ok: true, data: { id: prazoId, status: input.concluido ? 'concluido' : 'pendente' } };
  } catch (err) {
    return falha(err, 'alterarStatusPrazo');
  }
}

export async function excluirPrazo(id: string): Promise<ServiceResponse<{ id: string; removido: true }>> {
  try {
    const prazoId = idUnico(id, 'prazoId');
    await withBrowserContext(async (page) => {
      await abrir(page);
      await astreaApiPost(page, `/deadlines/${prazoId}/delete`, {});
    });
    return { ok: true, data: { id: prazoId, removido: true } };
  } catch (err) {
    return falha(err, 'excluirPrazo');
  }
}

export async function buscarPrazo(id: string): Promise<ServiceResponse<Prazo>> {
  try {
    const prazoId = idUnico(id, 'prazoId');
    const d = await withBrowserContext(async (page) => {
      await abrir(page);
      return astreaApiGet<Record<string, unknown>>(page, `/deadlines/${prazoId}`);
    });
    return {
      ok: true,
      data: {
        id: String(d.deadlineId ?? prazoId),
        titulo: String(d.name ?? ''),
        data: String(d.dueDate ?? ''),
        status: statusLegivel(d.status),
        processoId: d.caseId != null ? String(d.caseId) : undefined,
        processoTitulo: (d.caseTitle as string) || undefined,
        responsavelId: d.responsibleId != null ? String(d.responsibleId) : undefined,
        responsavelNome: (d.responsibleName as string) || undefined,
        etiquetas: mapEtiquetas(d.tagDtos),
        observacoes: (d.comments as string) || undefined,
      },
    };
  } catch (err) {
    return falha(err, 'buscarPrazo');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIÊNCIAS
// ─────────────────────────────────────────────────────────────────────────────

export interface CriarAudienciaInput {
  processoId: string;
  titulo: string;
  /** YYYY-MM-DD */
  data: string;
  /** HH:mm */
  horaInicio: string;
  /** HH:mm — default início + 30 min */
  horaFim?: string;
  responsavelId?: string;
  /** Fórum / vara (campo "courthouse"). */
  forum?: string;
  sala?: string;
  /** Endereço (presencial) ou link da sala virtual (remoto). */
  endereco?: string;
  /** Default presencial. */
  modalidade?: 'presencial' | 'remoto';
  etiquetasIds?: string[];
  observacoes?: string;
  /** Default true: recusa (CONFLICT) se o responsável já tem algo no horário. */
  verificarConflito?: boolean;
}

export type EditarAudienciaInput = Partial<Omit<CriarAudienciaInput, 'processoId'>>;

export interface Audiencia {
  id: string;
  titulo: string;
  data: string;
  horaInicio?: string;
  horaFim?: string;
  forum?: string;
  sala?: string;
  endereco?: string;
  modalidade?: 'presencial' | 'remoto';
  status: string;
  processoId?: string;
  processoTitulo?: string;
  responsavelId?: string;
  responsavelNome?: string;
  etiquetas: Array<{ id: string; nome: string }>;
  observacoes?: string;
}

function tipoEndereco(m: CriarAudienciaInput['modalidade']): string {
  return m === 'remoto' ? 'ONLINE_MEETING' : 'PHYSICAL_ADDRESS';
}

function validarHorario(inicio: string | undefined, fim: string | undefined): void {
  validar(inicio && RE_HORA.test(inicio), 'horaInicio deve ser HH:mm');
  if (fim !== undefined) {
    validar(RE_HORA.test(fim), 'horaFim deve ser HH:mm');
    validar(minutos(fim) > minutos(inicio), 'horaFim deve ser depois de horaInicio');
  }
}

export async function criarAudiencia(
  input: CriarAudienciaInput,
): Promise<ServiceResponse<{ id: string; processoId: string; data: string; horaInicio: string; horaFim: string }>> {
  try {
    const processoId = idUnico(input.processoId, 'processoId');
    const titulo = input.titulo?.trim();
    validar(titulo, 'titulo obrigatório');
    validar(dataValida(input.data), 'data deve ser YYYY-MM-DD');
    validarHorario(input.horaInicio, input.horaFim);
    const horaFim = input.horaFim ?? somarMin(input.horaInicio, DURACAO_PADRAO_MIN);
    const tagIds = etiquetas(input.etiquetasIds) ?? [];
    const respInformado = input.responsavelId ? idUnico(input.responsavelId, 'responsavelId') : undefined;

    const id = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      const responsavelId = respInformado ?? userId;
      if (input.verificarConflito !== false) {
        await checarConflito(page, userId, responsavelId, input.data, input.horaInicio, horaFim, null);
      }
      const resp = await astreaApiPost(page, '/hearings/save', {
        caseId: Number(processoId),
        historicalId: null,
        parentId: null,
        userId,
        notify: false,
        alertNumTimeUnit: 0,
        alertTimeUnit: 'TUE_HOURS',
        secondAlertNumTimeUnit: null,
        secondAlertTimeUnit: null,
        contactTypeEnum: 'INTERNAL_USER',
        status: 'IN_PROGRESS',
        address: input.endereco?.trim() ?? '',
        addressType: tipoEndereco(input.modalidade),
        rootCaseId: null,
        courthouse: input.forum?.trim() ?? '',
        courthouseRoom: input.sala?.trim() ?? '',
        hearingDateEnd: input.data,
        hearingDateStart: input.data,
        hearingTimeEnd: horaFim,
        name: titulo,
        hearingTimeStart: input.horaInicio,
        ownerId: userId,
        parentType: null,
        responsibleId: responsavelId,
        tagIds,
        comments: input.observacoes?.trim() ?? '',
        teamId: null,
        involved: [],
        reminders: [],
      });
      return idDaResposta(resp);
    });

    logger.info({ id, processoId }, 'criarAudiencia: OK');
    return { ok: true, data: { id, processoId, data: input.data, horaInicio: input.horaInicio, horaFim } };
  } catch (err) {
    return falha(err, 'criarAudiencia');
  }
}

export async function editarAudiencia(
  id: string,
  input: EditarAudienciaInput,
): Promise<ServiceResponse<{ id: string; alterados: string[] }>> {
  try {
    const audId = idUnico(id, 'audienciaId');
    const campos = [
      'titulo', 'data', 'horaInicio', 'horaFim', 'responsavelId', 'forum', 'sala',
      'endereco', 'modalidade', 'etiquetasIds', 'observacoes',
    ] as const;
    const alterados = campos.filter((k) => input[k] !== undefined);
    validar(alterados.length, 'informe ao menos um campo para alterar');
    if (input.titulo !== undefined) validar(input.titulo.trim(), 'titulo não pode ser vazio');
    if (input.data !== undefined) validar(dataValida(input.data), 'data deve ser YYYY-MM-DD');
    if (input.horaInicio !== undefined) validar(RE_HORA.test(input.horaInicio), 'horaInicio deve ser HH:mm');
    if (input.horaFim !== undefined) validar(RE_HORA.test(input.horaFim), 'horaFim deve ser HH:mm');
    const tagIds = etiquetas(input.etiquetasIds);
    const resp = input.responsavelId ? idUnico(input.responsavelId, 'responsavelId') : undefined;

    const salvo = await withBrowserContext(async (page) => {
      const userId = await abrir(page);
      const atual = await astreaApiGet<Record<string, unknown>>(page, `/hearings/${audId}`);

      const iniAtual = String(atual.hearingTimeStart ?? '');
      const fimAtual = String(atual.hearingTimeEnd ?? '');
      const duracao =
        RE_HORA.test(iniAtual) && RE_HORA.test(fimAtual) && minutos(fimAtual) > minutos(iniAtual)
          ? minutos(fimAtual) - minutos(iniAtual)
          : DURACAO_PADRAO_MIN;
      const data = input.data ?? String(atual.hearingDateStart ?? '');
      const horaInicio = input.horaInicio ?? iniAtual;
      const horaFim = input.horaFim ?? (input.horaInicio ? somarMin(input.horaInicio, duracao) : fimAtual);
      validarHorario(horaInicio, horaFim);
      const responsavelId = resp ?? String(atual.responsibleId ?? userId);

      const mudouHorario = input.data !== undefined || input.horaInicio !== undefined || input.horaFim !== undefined;
      if (input.verificarConflito !== false && (mudouHorario || resp)) {
        await checarConflito(page, userId, responsavelId, data, horaInicio, horaFim, Number(audId));
      }

      const body: Record<string, unknown> = {
        ...atual,
        userId,
        hearingDateStart: data,
        hearingDateEnd: input.data ?? atual.hearingDateEnd ?? data,
        hearingTimeStart: horaInicio,
        hearingTimeEnd: horaFim,
        alertNumTimeUnit: atual.alertNumTimeUnit ?? 0,
        alertTimeUnit: atual.alertTimeUnit ?? 'TUE_HOURS',
        contactTypeEnum: atual.contactTypeEnum ?? 'INTERNAL_USER',
        rootCaseId: atual.rootCaseId ?? null,
        ...kanbanDaEdicao(atual),
        shouldNotify: false,
        notify: false,
      };
      if (input.titulo !== undefined) body.name = input.titulo.trim();
      if (input.forum !== undefined) body.courthouse = input.forum;
      if (input.sala !== undefined) body.courthouseRoom = input.sala;
      if (input.endereco !== undefined) body.address = input.endereco;
      if (input.modalidade !== undefined) body.addressType = tipoEndereco(input.modalidade);
      if (input.observacoes !== undefined) body.comments = input.observacoes;
      if (resp) body.responsibleId = resp;
      if (tagIds !== undefined) {
        body.tagIds = tagIds;
        delete body.tagDtos;
      }
      // Log de comentários é só leitura — não reenviar.
      delete body.commentsList;

      return idDaResposta(await astreaApiPost(page, '/hearings/save', body), audId);
    });

    return { ok: true, data: { id: salvo, alterados } };
  } catch (err) {
    return falha(err, 'editarAudiencia');
  }
}

export async function excluirAudiencia(id: string): Promise<ServiceResponse<{ id: string; removido: true }>> {
  try {
    const audId = idUnico(id, 'audienciaId');
    await withBrowserContext(async (page) => {
      await abrir(page);
      await astreaApiPost(page, `/hearings/${audId}/delete`, {});
    });
    return { ok: true, data: { id: audId, removido: true } };
  } catch (err) {
    return falha(err, 'excluirAudiencia');
  }
}

export async function buscarAudiencia(id: string): Promise<ServiceResponse<Audiencia>> {
  try {
    const audId = idUnico(id, 'audienciaId');
    const d = await withBrowserContext(async (page) => {
      await abrir(page);
      return astreaApiGet<Record<string, unknown>>(page, `/hearings/${audId}`);
    });
    const tipo = String(d.addressType ?? '');
    return {
      ok: true,
      data: {
        id: String(d.hearingId ?? audId),
        titulo: String(d.name ?? ''),
        data: String(d.hearingDateStart ?? ''),
        horaInicio: (d.hearingTimeStart as string) || undefined,
        horaFim: (d.hearingTimeEnd as string) || undefined,
        forum: (d.courthouse as string) || undefined,
        sala: (d.courthouseRoom as string) || undefined,
        endereco: (d.address as string) || undefined,
        modalidade: tipo === 'ONLINE_MEETING' ? 'remoto' : tipo === 'PHYSICAL_ADDRESS' ? 'presencial' : undefined,
        status: statusLegivel(d.status),
        processoId: d.caseId != null ? String(d.caseId) : undefined,
        processoTitulo: (d.caseTitle as string) || undefined,
        responsavelId: d.responsibleId != null ? String(d.responsibleId) : undefined,
        responsavelNome: (d.responsibleName as string) || undefined,
        etiquetas: mapEtiquetas(d.tagDtos),
        observacoes: (d.comments as string) || undefined,
      },
    };
  } catch (err) {
    return falha(err, 'buscarAudiencia');
  }
}
