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

// ─────────────────────────────────────────────────────────────────────────────
// processosNovosPorMes — 1× /case-list/count por mês, filtrando a DATA DE CADASTRO.
//
// Confirmado ao vivo em 23/10/2026 (scripts/sondar-createddate-manual.mjs): o período
// personalizado exige o marcador `createddate: "MANUAL"` junto de `fromDate`/`toDate`
// (meia-noite de Brasília, 03:00Z, do 1º e do último dia). Com `createddate: null` as
// datas são ignoradas e o count devolve a carteira inteira. Os outros valores do DateEnum
// (TODAY/WEEK/MONTH/TWO_MONTHS/THREE_MONTHS) são janelas móveis, não meses do calendário.
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcoesNovosPorMes {
  /** Quantos meses (default 12, máx 36), terminando em `ate`. */
  meses?: number;
  /** Último mês, `YYYY-MM` (default: mês corrente em Brasília). */
  ate?: string;
}

export interface NovosPorMes {
  total: number;
  meses: Array<{ mes: string; total: number }>;
}

function mesCorrenteSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
}

/** Lista de meses `YYYY-MM`, do mais antigo para `ate`. */
export function listaDeMeses(ate: string, n: number): string[] {
  const [a, m] = ate.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = a * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

function limitesDoMes(mes: string): { fromDate: string; toDate: string } {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { fromDate: `${mes}-01T03:00:00.000Z`, toDate: `${mes}-${String(ultimo).padStart(2, '0')}T03:00:00.000Z` };
}

export async function processosNovosPorMes(
  filtros: FiltrosEstatisticaProcesso = {},
  opcoes: OpcoesNovosPorMes = {},
): Promise<ServiceResponse<NovosPorMes>> {
  try {
    const n = opcoes.meses ?? 12;
    if (!Number.isInteger(n) || n < 1 || n > 36) throw new Error('VALIDATION_ERROR: meses deve ser de 1 a 36');
    const ate = opcoes.ate ?? mesCorrenteSP();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ate)) throw new Error('VALIDATION_ERROR: ate deve ser YYYY-MM');
    // Processos "novos" incluem os que já foram encerrados: status todos por padrão.
    const f: FiltrosEstatisticaProcesso = { ...filtros, status: filtros.status ?? 'todos' };
    buildCaseQueryDTO(f, 0);

    const meses = await withBrowserContext(async (page) => {
      await navigateTo(page, ANGULAR_PAGE_PATH);
      const userId = Number(await getAstreaUserId(page));
      const base = buildCaseQueryDTO(f, userId);
      const out: Array<{ mes: string; total: number }> = [];
      for (const mes of listaDeMeses(ate, n)) {
        const queryDTO = { ...base, createddate: 'MANUAL', ...limitesDoMes(mes) };
        const res = await astreaApiPost<{ count?: number }>(page, '/case-list/count', buildCaseQueryBody(queryDTO, userId));
        if (typeof res?.count !== 'number') throw new Error(`API_ERROR: /case-list/count sem count para ${mes}`);
        out.push({ mes, total: res.count });
      }
      return out;
    });

    return { ok: true, data: { total: meses.reduce((s, x) => s + x.total, 0), meses } };
  } catch (err) {
    return falha(err, 'processosNovosPorMes');
  }
}
