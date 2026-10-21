// ─────────────────────────────────────────────────────────────────────────────
// queryDTO de POST /api/v2/case/query e /api/v2/case-list/count
//
// Módulo PURO (sem browser) para ser compartilhado por casos.service e
// processos-estatisticas.service — e testável sem mocks.
//
// Formato capturado da tela "Processos e casos" em 2026-05-16. Os campos
// `tagIds` (etiquetas) e `contacts` (clientes) recebem IDs numéricos; em
// `contacts` isso já é validado em produção (buscarCasosPorCliente).
// ─────────────────────────────────────────────────────────────────────────────

import type { FiltrosProcesso } from '../types/index.js';

const STATUS_QUERY_MAP: Record<NonNullable<FiltrosProcesso['status']>, string | null> = {
  ativo: 'Active',
  arquivado: 'Inactive',
  todos: null,
};

const TIPO_QUERY_MAP: Record<NonNullable<FiltrosProcesso['tipo']>, string[]> = {
  caso: ['CTE_CASE'],
  processo: ['CTE_LAWSUIT'],
  todos: [],
};

/**
 * Converte IDs do Astrea (string) para número, sem duplicatas.
 * IDs fora do intervalo seguro do JS perderiam precisão → rejeitados.
 */
export function normalizarIdsNumericos(ids: readonly string[] | undefined, campo = 'id'): number[] {
  if (!ids?.length) return [];
  const out: number[] = [];
  for (const raw of ids) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const n = Number(s);
    if (!/^\d+$/.test(s) || !Number.isSafeInteger(n)) {
      throw new Error(`VALIDATION_ERROR: ${campo} inválido: ${s}`);
    }
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export function buildCaseQueryDTO(
  filtros: FiltrosProcesso | undefined,
  userId: number,
): Record<string, unknown> {
  const statusKey: NonNullable<FiltrosProcesso['status']> = filtros?.status ?? 'ativo';
  const tipoKey: NonNullable<FiltrosProcesso['tipo']> = filtros?.tipo ?? 'todos';
  const users = filtros?.responsavelId
    ? normalizarIdsNumericos([filtros.responsavelId], 'responsavelId')
    : [];

  return {
    contacts: normalizarIdsNumericos(filtros?.clienteIds, 'clienteId'),
    lawsuitTypes: [],
    titles: [],
    folders: [],
    courts: [],
    stakeholderRoles: [],
    divisionNames: [],
    numbers: [],
    userId,
    order: '-lastMovement',
    types: TIPO_QUERY_MAP[tipoKey],
    instances: [],
    status: STATUS_QUERY_MAP[statusKey],
    tagIds: normalizarIdsNumericos(filtros?.etiquetasIds, 'etiquetaId'),
    treeView: false,
    onlyImportant: null,
    notUpdated: null,
    isFromContactScreen: false,
    treeMode: false,
    historiesMovement: null,
    createddate: null,
    shareddate: null,
    endeddate: null,
    users,
    team: null,
  };
}

/** Corpo padrão de /case/query e /case-list/count. */
export function buildCaseQueryBody(
  queryDTO: Record<string, unknown>,
  userId: number,
  cursor = '',
  limit = 100,
): Record<string, unknown> {
  return { userId, limit, queryCursor: cursor, queryDTO, currentOrder: '-lastMovement' };
}

/** Converte "API_ERROR"/"VALIDATION_ERROR: ..." de uma exceção no código de ServiceError. */
export function codigoDoErro(err: unknown): 'VALIDATION_ERROR' | 'SESSION_EXPIRED' | 'API_ERROR' {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith('VALIDATION_ERROR')) return 'VALIDATION_ERROR';
  if (msg.startsWith('SESSION_EXPIRED')) return 'SESSION_EXPIRED';
  return 'API_ERROR';
}
