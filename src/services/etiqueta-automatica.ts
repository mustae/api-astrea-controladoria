// ─────────────────────────────────────────────────────────────────────────────
// Etiqueta aplicada automaticamente a toda audiência criada pela API
//
// Decisão do escritório (26/10/2026): toda audiência leva a etiqueta "Audiência".
// ETIQUETA_AUDIENCIA (.env) troca a etiqueta (nome ou id) ou desliga ("nenhuma").
// Etiqueta inexistente, inativa ou não permitida em audiência só gera aviso no log:
// a audiência é criada sem ela.
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { astreaApiGet } from '../browser/astrea-http.js';
import { env } from '../config/env.js';
import { InflightTtlCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { semAcento } from '../utils/sanitize.js';

export interface RawTag {
  id: number | string;
  label?: string;
  active?: boolean;
  restrictions?: string[];
}

const PADRAO = 'Audiência';

// Etiquetas mudam raramente; 5 min evita um GET por audiência criada.
const cache = new InflightTtlCache<RawTag[]>(5 * 60_000);

export function limparCacheEtiquetaAutomatica(): void {
  cache.clear();
}


/** Todas as etiquetas do escritório (cache de 5 min, compartilhado com regras-natureza). */
export async function etiquetasDoTenant(page: Page): Promise<RawTag[]> {
  return cache.get('tags', async () => {
    const r = await astreaApiGet<{ items?: RawTag[] }>(page, '/tags/get-all-tags');
    return r?.items ?? [];
  });
}

/** Id da etiqueta obrigatória das audiências, ou null (desligada/não encontrada). */
export async function etiquetaDaAudiencia(
  page: Page,
  valor: string = env.ETIQUETA_AUDIENCIA ?? PADRAO,
): Promise<string | null> {
  const alvo = valor.trim() || PADRAO;
  if (semAcento(alvo) === 'nenhuma') return null;

  const tags = await etiquetasDoTenant(page);
  const tag =
    tags.find((t) => String(t.id) === alvo) ?? tags.find((t) => semAcento(t.label ?? '') === semAcento(alvo));
  const usavel =
    tag && tag.active !== false && (!tag.restrictions?.length || tag.restrictions.includes('HEARING'));
  if (!usavel) {
    logger.warn({ etiqueta: alvo }, 'Etiqueta automática de audiência não encontrada/permitida; audiência criada sem ela');
    return null;
  }
  return String(tag.id);
}

export function comEtiqueta(ids: string[], id: string | null): string[] {
  return id && !ids.includes(id) ? [...ids, id] : ids;
}
