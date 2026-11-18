// ─────────────────────────────────────────────────────────────────────────────
// Destino na Gestão Kanban de uma atividade nova (tarefa, prazo, audiência, compromisso)
//
// O formulário do Astrea (bundle de 23/10/2026) inclui a atividade num quadro pelos
// campos "Quadro do Kanban" / "Coluna do Kanban": no save vão kanbanId e kanbanColumnId
// (strings) e kanbanDetails {id, columnId}. Sem eles a atividade fica fora do Kanban.
//
// Ordem de decisão:
//   1. pedido da chamada: `false` (fora) ou { quadro, coluna? } por nome ou id;
//   2. senão, a regra da natureza (quadro pelo cliente do processo, ver regras-natureza.ts);
//   3. senão, a regra do tipo no .env (KANBAN_TAREFA, KANBAN_PRAZO, ...);
//   4. sem regra: tarefa/prazo → quadro padrão; audiência → AUDIENCIAS & PERICIAS;
//      compromisso → fora.
// Sem coluna informada, a atividade entra na 1ª coluna do quadro.
// Pedido com quadro/coluna inexistente → VALIDATION_ERROR. Regra mal configurada só
// gera aviso no log: a atividade é criada fora do Kanban.
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { astreaApiGet } from '../browser/astrea-http.js';
import { env } from '../config/env.js';
import { InflightTtlCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import type { KanbanAplicado, PedidoKanban as Pedido } from '../models/kanban.js';
import { semAcento } from '../utils/sanitize.js';

export type PedidoKanban = Pedido | undefined;

export type TipoAtividadeKanban = 'tarefa' | 'prazo' | 'audiencia' | 'compromisso';


export type Regra = 'padrao' | 'nenhum' | { quadro: string; coluna?: string };
export type RegrasKanban = Record<TipoAtividadeKanban, string | undefined>;

export type DestinoKanbanResolvido = KanbanAplicado;

interface RawColuna {
  id: number | string;
  name: string;
  type?: string;
}

interface RawQuadro {
  id: number | string;
  name: string;
  default?: boolean;
  columns?: RawColuna[];
}

const FALLBACK: Record<TipoAtividadeKanban, Regra> = {
  tarefa: 'padrao',
  prazo: 'padrao',
  // Decisão do escritório (26/10/2026): toda audiência vai para este quadro.
  audiencia: { quadro: 'AUDIENCIAS & PERICIAS' },
  compromisso: 'nenhum',
};

// Quadros mudam raramente; 5 min evita um GET /kanbans por criação.
const cacheQuadros = new InflightTtlCache<RawQuadro[]>(5 * 60_000);

export function limparCacheQuadrosKanban(): void {
  cacheQuadros.clear();
}

export function regrasDoEnv(): RegrasKanban {
  return {
    tarefa: env.KANBAN_TAREFA,
    prazo: env.KANBAN_PRAZO,
    audiencia: env.KANBAN_AUDIENCIA,
    compromisso: env.KANBAN_COMPROMISSO,
  };
}


/** "padrao" | "nenhum" | "Quadro" | "Quadro > Coluna"; vazio/ausente → fallback do tipo. */
export function lerRegra(valor: string | undefined, fallback: Regra): Regra {
  const v = (valor ?? '').trim();
  if (!v) return fallback;
  const n = semAcento(v);
  if (n === 'padrao') return 'padrao';
  if (n === 'nenhum') return 'nenhum';
  const [quadro, coluna] = v.split('>').map((s) => s.trim());
  return coluna ? { quadro, coluna } : { quadro };
}

export function validarPedidoKanban(pedido: PedidoKanban): void {
  if (pedido === undefined || pedido === false) return;
  if (typeof pedido !== 'object' || !pedido.quadro?.trim()) {
    throw new Error('VALIDATION_ERROR: kanban.quadro é obrigatório (nome ou id de listar_quadros_kanban), ou use kanban: false');
  }
  if (pedido.coluna !== undefined && !pedido.coluna.trim()) {
    throw new Error('VALIDATION_ERROR: kanban.coluna não pode ser vazia');
  }
}

function acharPorIdOuNome<T extends { id: number | string; name: string }>(lista: T[], alvo: string): T | undefined {
  const a = alvo.trim();
  return lista.find((x) => String(x.id) === a) ?? lista.find((x) => semAcento(x.name) === semAcento(a));
}

class DestinoInvalido extends Error {}

function escolher(quadros: RawQuadro[], quadroAlvo: string | 'padrao', colunaAlvo?: string): DestinoKanbanResolvido {
  const quadro = quadroAlvo === 'padrao' ? quadros.find((q) => q.default) : acharPorIdOuNome(quadros, quadroAlvo);
  if (!quadro) {
    const nomes = quadros.map((q) => q.name).join(', ') || '(nenhum)';
    throw new DestinoInvalido(`quadro Kanban "${quadroAlvo}" não existe. Quadros: ${nomes}`);
  }
  const colunas = quadro.columns ?? [];
  const coluna = colunaAlvo ? acharPorIdOuNome(colunas, colunaAlvo) : colunas[0];
  if (!coluna) {
    const nomes = colunas.map((c) => c.name).join(', ') || '(nenhuma)';
    throw new DestinoInvalido(`coluna "${colunaAlvo ?? ''}" não existe no quadro "${quadro.name}". Colunas: ${nomes}`);
  }
  return { quadroId: String(quadro.id), quadroNome: quadro.name, colunaId: String(coluna.id), colunaNome: coluna.name };
}

async function quadros(page: Page): Promise<RawQuadro[]> {
  return cacheQuadros.get('quadros', async () => {
    const r = await astreaApiGet<RawQuadro[]>(page, '/kanbans');
    return Array.isArray(r) ? r : [];
  });
}

export async function resolverDestinoKanban(
  page: Page,
  tipo: TipoAtividadeKanban,
  pedido: PedidoKanban,
  regras: RegrasKanban = regrasDoEnv(),
  regraDaNatureza?: string,
): Promise<DestinoKanbanResolvido | null> {
  if (pedido === false) return null;

  if (pedido) {
    try {
      return escolher(await quadros(page), pedido.quadro, pedido.coluna);
    } catch (err) {
      if (err instanceof DestinoInvalido) throw new Error(`VALIDATION_ERROR: ${err.message}`);
      throw err;
    }
  }

  const valorDaRegra = regraDaNatureza ?? regras[tipo];
  const regra = lerRegra(valorDaRegra, FALLBACK[tipo]);
  if (regra === 'nenhum') return null;
  try {
    const lista = await quadros(page);
    return regra === 'padrao' ? escolher(lista, 'padrao') : escolher(lista, regra.quadro, regra.coluna);
  } catch (err) {
    if (!(err instanceof DestinoInvalido)) throw err;
    logger.warn({ tipo, regra: valorDaRegra, motivo: err.message }, 'Regra de Kanban inválida; atividade criada fora do Kanban');
    return null;
  }
}

/** Campos do save do Astrea; `{}` deixa a atividade fora do Kanban. */
export function camposKanban(destino: DestinoKanbanResolvido | null): Record<string, unknown> {
  if (!destino) return {};
  return {
    kanbanId: destino.quadroId,
    kanbanColumnId: destino.colunaId,
    kanbanDetails: { id: destino.quadroId, columnId: destino.colunaId },
  };
}
