// ─────────────────────────────────────────────────────────────────────────────
// Service: estatísticas de processos/casos
//
//  - contarProcessos     → POST /api/v2/case-list/count  (1 chamada)
//  - processosPorCliente → POST /api/v2/case/query paginado por cursor,
//                          agrupado localmente pelo cliente principal
//
// Mesmo queryDTO de listarProcessos (casos-query.ts), então todos os filtros
// (tipo, status, responsável, etiquetas, clientes) valem aqui também.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ANGULAR_PAGE_PATH,
  astreaApiPost,
  getAstreaUserId,
  withBrowserContext,
} from '../browser/astrea-http.js';
import { navigateTo } from '../browser/navigator.js';
import { isRetryablePlaywrightError } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { buildCaseQueryBody, buildCaseQueryDTO, codigoDoErro } from './casos-query.js';
import type { FiltrosProcesso, ServiceResponse } from '../types/index.js';

export type FiltrosEstatisticaProcesso = Omit<FiltrosProcesso, 'pagina' | 'limite'>;

interface AstreaCaseQueryItem {
  id: string | number;
  customer?: string;
  customerId?: string | number;
  customers?: Array<{ id?: number | string; name?: string; main?: boolean }>;
}

interface AstreaCaseQueryResponse {
  cursor?: string;
  cases?: AstreaCaseQueryItem[];
}

export interface ContagemProcessos {
  total: number;
}

export interface ClienteComProcessos {
  clienteId: string;
  clienteNome?: string;
  quantidade: number;
}

export interface ProcessosPorCliente {
  totalProcessos: number;
  totalClientes: number;
  /** Processos sem cliente vinculado (ex.: sincronizados do tribunal). */
  semCliente: number;
  /** true se parou em `maxProcessos` antes do fim da carteira. */
  truncado: boolean;
  clientes: ClienteComProcessos[];
}

export interface OpcoesPorCliente {
  /** Quantos clientes devolver (default 20, máx 500). */
  topN?: number;
  /** Teto de processos varridos (default 5000, máx 20000). */
  maxProcessos?: number;
}

const PAGE_SIZE = 100;

function falha<T>(err: unknown, onde: string): ServiceResponse<T> {
  logger.error({ err }, `Erro em ${onde}`);
  return {
    ok: false,
    error: {
      message: err instanceof Error ? err.message : 'Erro desconhecido',
      code: codigoDoErro(err),
      retryable: isRetryablePlaywrightError(err),
    },
  };
}

export async function contarProcessos(
  filtros: FiltrosEstatisticaProcesso = {},
): Promise<ServiceResponse<ContagemProcessos>> {
  try {
    // Valida IDs antes de abrir aba (VALIDATION_ERROR sem custo de browser).
    buildCaseQueryDTO(filtros, 0);

    const total = await withBrowserContext(async (page) => {
      await navigateTo(page, ANGULAR_PAGE_PATH);
      const userId = Number(await getAstreaUserId(page));
      const queryDTO = buildCaseQueryDTO(filtros, userId);
      const res = await astreaApiPost<{ count?: number }>(
        page,
        '/case-list/count',
        buildCaseQueryBody(queryDTO, userId),
      );
      if (typeof res?.count !== 'number') {
        throw new Error('API_ERROR: /case-list/count não retornou `count`');
      }
      return res.count;
    });

    return { ok: true, data: { total } };
  } catch (err) {
    return falha(err, 'contarProcessos');
  }
}

function clientePrincipal(c: AstreaCaseQueryItem): { id: string; nome?: string } | undefined {
  const p = (c.customers ?? []).find((x) => x.main === true) ?? c.customers?.[0];
  if (p?.id != null && String(p.id) !== '') return { id: String(p.id), nome: p.name };
  if (c.customerId != null && String(c.customerId) !== '') {
    return { id: String(c.customerId), nome: c.customer };
  }
  return undefined;
}

export async function processosPorCliente(
  filtros: FiltrosEstatisticaProcesso = {},
  opcoes: OpcoesPorCliente = {},
): Promise<ServiceResponse<ProcessosPorCliente>> {
  const topN = Math.max(1, Math.min(opcoes.topN ?? 20, 500));
  const maxProcessos = Math.max(PAGE_SIZE, Math.min(opcoes.maxProcessos ?? 5000, 20_000));

  try {
    buildCaseQueryDTO(filtros, 0);

    const data = await withBrowserContext(async (page) => {
      await navigateTo(page, ANGULAR_PAGE_PATH);
      const userId = Number(await getAstreaUserId(page));
      const queryDTO = buildCaseQueryDTO(filtros, userId);

      const grupos = new Map<string, ClienteComProcessos>();
      let total = 0;
      let semCliente = 0;
      let cursor = '';
      let truncado = false;

      while (true) {
        const res = await astreaApiPost<AstreaCaseQueryResponse>(
          page,
          '/case/query',
          buildCaseQueryBody(queryDTO, userId, cursor, PAGE_SIZE),
        );
        const cases = res?.cases ?? [];
        let consumidos = 0;
        for (const c of cases) {
          if (total >= maxProcessos) break;
          total++;
          consumidos++;
          const cli = clientePrincipal(c);
          if (!cli) {
            semCliente++;
            continue;
          }
          const g = grupos.get(cli.id);
          if (g) {
            g.quantidade++;
            if (!g.clienteNome && cli.nome) g.clienteNome = cli.nome;
          } else {
            grupos.set(cli.id, { clienteId: cli.id, clienteNome: cli.nome, quantidade: 1 });
          }
        }
        const temMais = cases.length >= PAGE_SIZE && !!res?.cursor;
        if (total >= maxProcessos) {
          // Sobrou item nesta página ou há próxima página → a carteira não foi toda varrida.
          truncado = consumidos < cases.length || temMais;
          break;
        }
        if (!temMais) break;
        cursor = res.cursor!;
      }

      const clientes = [...grupos.values()]
        .sort((a, b) => b.quantidade - a.quantidade || (a.clienteNome ?? '').localeCompare(b.clienteNome ?? '', 'pt-BR'))
        .slice(0, topN);

      logger.info({ total, clientes: grupos.size, truncado }, 'processosPorCliente: OK');
      return { totalProcessos: total, totalClientes: grupos.size, semCliente, truncado, clientes };
    });

    return { ok: true, data };
  } catch (err) {
    return falha(err, 'processosPorCliente');
  }
}
