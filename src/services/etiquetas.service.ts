// ─────────────────────────────────────────────────────────────────────────────
// Service: Etiquetas (tags) do Astrea
//
// Endpoint REST interno: GET /api/v2/tags/get-all-tags
//   → { items: [{ id, label, color?, active?, restrictions? }] }
// Já usado por casos.service (resolveTagLabels) desde 21/02/2026.
// `restrictions` (CASES/TASKS/APPOINTMENTS) indica onde a etiqueta pode ser
// usada; ausente = sem restrição.
//
// Cache 5 min + inflight dedup: etiquetas mudam raramente e a listagem é usada
// como "dicionário" antes de filtrar processos.
// ─────────────────────────────────────────────────────────────────────────────

import { ANGULAR_PAGE_PATH, astreaApiGet, withBrowserContext } from '../browser/astrea-http.js';
import { navigateTo } from '../browser/navigator.js';
import { InflightTtlCache } from '../utils/cache.js';
import { isRetryablePlaywrightError } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { codigoDoErro } from './casos-query.js';
import type { ServiceResponse } from '../types/index.js';

export type RestricaoEtiqueta = 'CASES' | 'TASKS' | 'APPOINTMENTS' | string;

export interface Etiqueta {
  id: string;
  nome: string;
  cor?: string;
  ativa: boolean;
  /** Onde a etiqueta pode ser usada. Vazio = qualquer lugar. */
  restricoes: RestricaoEtiqueta[];
}

interface AstreaTag {
  id: string | number;
  label?: string;
  color?: string;
  active?: boolean;
  restrictions?: string[];
}

interface AstreaTagsResponse {
  items?: AstreaTag[];
}

export interface OpcoesListarEtiquetas {
  incluirInativas?: boolean;
  /** Filtro textual (sem acento, sem caixa) sobre o nome. */
  busca?: string;
  /** Mantém só etiquetas usáveis nesse contexto (ou sem restrição). */
  uso?: 'processos' | 'tarefas' | 'compromissos';
}

const USO_PARA_RESTRICAO: Record<NonNullable<OpcoesListarEtiquetas['uso']>, string> = {
  processos: 'CASES',
  tarefas: 'TASKS',
  compromissos: 'APPOINTMENTS',
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new InflightTtlCache<Etiqueta[]>(CACHE_TTL_MS);

export function resetarEtiquetasCache(): void {
  cache.clear();
}

export function getEtiquetasCacheStats() {
  return cache.stats;
}

export function mapTag(t: AstreaTag): Etiqueta {
  return {
    id: String(t.id),
    nome: (t.label ?? '').trim(),
    cor: t.color || undefined,
    ativa: t.active !== false,
    restricoes: Array.isArray(t.restrictions) ? [...t.restrictions] : [],
  };
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

async function carregarTodas(): Promise<Etiqueta[]> {
  return withBrowserContext(
    async (page) => {
      await navigateTo(page, ANGULAR_PAGE_PATH);
      const res = await astreaApiGet<AstreaTagsResponse>(page, '/tags/get-all-tags');
      return (res?.items ?? []).map(mapTag);
    },
    { warm: true },
  );
}

export async function listarEtiquetas(
  opcoes: OpcoesListarEtiquetas = {},
): Promise<ServiceResponse<Etiqueta[]>> {
  try {
    const todas = await cache.get('all', carregarTodas);
    let itens = opcoes.incluirInativas ? todas : todas.filter((e) => e.ativa);

    if (opcoes.uso) {
      const r = USO_PARA_RESTRICAO[opcoes.uso];
      itens = itens.filter((e) => e.restricoes.length === 0 || e.restricoes.includes(r));
    }
    if (opcoes.busca?.trim()) {
      const q = semAcento(opcoes.busca.trim());
      itens = itens.filter((e) => semAcento(e.nome).includes(q));
    }

    itens = [...itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return { ok: true, data: itens };
  } catch (err) {
    logger.error({ err }, 'Erro em listarEtiquetas');
    return {
      ok: false,
      error: {
        message: err instanceof Error ? err.message : 'Erro desconhecido',
        code: codigoDoErro(err),
        retryable: isRetryablePlaywrightError(err),
      },
    };
  }
}
