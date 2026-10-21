import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  criarCaso,
  criarProcesso,
  listarCasos,
  buscarCaso,
  listarProcessos,
} from '../services/casos.service.js';
import { listarAndamentos } from '../services/andamentos.service.js';
import {
  contarProcessos,
  processosNovosPorMes,
  processosPorCliente,
} from '../services/processos-estatisticas.service.js';
import { httpStatusDoCodigo, idsStringArraySchema } from './query-helpers.js';
import type { ApiResponse, ApiError } from '../types/index.js';
import type { CasoProcesso } from '../models/caso-processo.js';

const router = Router();

const querySchema = z.object({
  clienteId: z.string().optional(),
  status: z.string().optional(),
  area: z.string().optional(),
  pagina: z.coerce.number().int().positive().default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

const compartilharSchema = z.enum(['publico', 'privado', 'equipe']);

const criarCasoSchema = z.object({
  cliente: z.string().min(1, 'Cliente é obrigatório (ID, nome ou CPF)'),
  titulo: z.string().min(1, 'Título é obrigatório'),
  descricao: z.string().optional(),
  observacoes: z.string().optional(),
  responsavelId: z.string().optional(),
  sharingType: compartilharSchema.optional(),
  tagsIds: z.array(z.string()).optional(),
  teamId: z.string().optional(),
});

const criarProcessoSchema = criarCasoSchema.extend({
  numeroProcesso: z.string().optional(),
  instancia: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  juizoNumero: z.string().optional(),
  vara: z.string().optional(),
  foro: z.string().optional(),
  acao: z.string().optional(),
  urlTribunal: z.string().optional(),
  objeto: z.string().optional(),
  valorCausa: z.number().optional(),
  distribuidoEm: z.string().optional(),
  valorCondenacao: z.number().optional(),
  papelCliente: z.string().optional(),
});

function statusFromCode(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'VALIDATION_ERROR') return 400;
  if (code === 'BROWSER_UNAVAILABLE') return 503;
  return 500;
}

const processosQuerySchema = z.object({
  tipo: z.enum(['caso', 'processo', 'todos']).optional(),
  status: z.enum(['ativo', 'arquivado', 'todos']).optional(),
  responsavelId: z.string().optional(),
  etiquetasIds: idsStringArraySchema,
  clienteIds: idsStringArraySchema,
  pagina: z.coerce.number().int().positive().default(1),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

const filtrosEstatisticaSchema = processosQuerySchema.omit({ pagina: true, limite: true });

const porClienteSchema = filtrosEstatisticaSchema.extend({
  topN: z.coerce.number().int().min(1).max(500).optional(),
  maxProcessos: z.coerce.number().int().min(100).max(20000).optional(),
});

function erroValidacao(res: Response, err: z.ZodError): void {
  const error: ApiError = {
    success: false,
    error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    code: 'VALIDATION_ERROR',
  };
  res.status(400).json(error);
}

/** Remove chaves undefined (o service recebe só o que foi informado). */
function compacto<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** GET /api/casos/processos/contagem — total de processos/casos para os filtros (1 chamada). */
router.get('/processos/contagem', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = filtrosEstatisticaSchema.safeParse(req.query);
    if (!parsed.success) return erroValidacao(res, parsed.error);

    const result = await contarProcessos(compacto(parsed.data));
    if (!result.ok) {
      const error: ApiError = { success: false, error: result.error.message, code: result.error.code };
      res.status(httpStatusDoCodigo(result.error.code)).json(error);
      return;
    }
    const response: ApiResponse<typeof result.data> = { success: true, data: result.data };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/** GET /api/casos/processos/por-cliente — ranking de clientes por quantidade de processos. */
router.get('/processos/por-cliente', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = porClienteSchema.safeParse(req.query);
    if (!parsed.success) return erroValidacao(res, parsed.error);

    const { topN, maxProcessos, ...filtros } = parsed.data;
    const result = await processosPorCliente(compacto(filtros), compacto({ topN, maxProcessos }));
    if (!result.ok) {
      const error: ApiError = { success: false, error: result.error.message, code: result.error.code };
      res.status(httpStatusDoCodigo(result.error.code)).json(error);
      return;
    }
    const response: ApiResponse<typeof result.data> = { success: true, data: result.data };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

const novosPorMesSchema = filtrosEstatisticaSchema.extend({
  meses: z.coerce.number().int().min(1).max(36).optional(),
  ate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM').optional(),
});

/** GET /api/casos/processos/novos-por-mes — processos cadastrados por mês (data de cadastro). */
router.get('/processos/novos-por-mes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = novosPorMesSchema.safeParse(req.query);
    if (!parsed.success) return erroValidacao(res, parsed.error);
    const { meses, ate, ...filtros } = parsed.data;
    const result = await processosNovosPorMes(compacto(filtros), compacto({ meses, ate }));
    if (!result.ok) {
      const error: ApiError = { success: false, error: result.error.message, code: result.error.code };
      res.status(httpStatusDoCodigo(result.error.code)).json(error);
      return;
    }
    const response: ApiResponse<typeof result.data> = { success: true, data: result.data };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/** GET /api/casos/processos — enumera casos/processos do escritório (resumo) */
router.get('/processos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filtros = processosQuerySchema.parse(req.query);
    const result = await listarProcessos(filtros);

    if (!result.ok) {
      const error: ApiError = {
        success: false,
        error: result.error.message,
        code: result.error.code,
      };
      res.status(httpStatusDoCodigo(result.error.code)).json(error);
      return;
    }

    const response: ApiResponse<typeof result.data> = {
      success: true,
      data: result.data,
      meta: result.meta,
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/** GET /api/casos */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filtros = querySchema.parse(req.query);
    const result = await listarCasos(filtros);

    if (!result.ok) {
      const error: ApiError = { success: false, error: result.error.message, code: result.error.code };
      res.status(result.error.code === 'BROWSER_UNAVAILABLE' ? 503 : 500).json(error);
      return;
    }

    const response: ApiResponse<typeof result.data> = { success: true, data: result.data, meta: result.meta };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/** POST /api/casos — cria um caso direto (sem passar por atendimento) */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = criarCasoSchema.parse(req.body);
    const result = await criarCaso(body);

    if (!result.ok) {
      const error: ApiError = {
        success: false,
        error: result.error.message,
        code: result.error.code,
      };
      res.status(statusFromCode(result.error.code)).json(error);
      return;
    }

    const response: ApiResponse<CasoProcesso> = { success: true, data: result.data };
    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
});

/** POST /api/casos/processo — cria um processo direto (sem passar por atendimento) */
router.post('/processo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = criarProcessoSchema.parse(req.body);
    const result = await criarProcesso(body);

    if (!result.ok) {
      const error: ApiError = {
        success: false,
        error: result.error.message,
        code: result.error.code,
      };
      res.status(statusFromCode(result.error.code)).json(error);
      return;
    }

    const response: ApiResponse<CasoProcesso> = { success: true, data: result.data };
    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
});

/** GET /api/casos/:id — Retorna dados completos do caso/processo incluindo histórico */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await buscarCaso(req.params.id);

    if (!result.ok) {
      const error: ApiError = { success: false, error: result.error.message, code: result.error.code };
      res.status(result.error.code === 'NOT_FOUND' ? 404 : 500).json(error);
      return;
    }

    const response: ApiResponse<CasoProcesso> = { success: true, data: result.data };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/** GET /api/casos/:id/andamentos */
router.get('/:id/andamentos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filtros = z
      .object({
        dataInicio: z.string().optional(),
        dataFim: z.string().optional(),
        pagina: z.coerce.number().int().positive().default(1),
        limite: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);

    const result = await listarAndamentos(req.params.id, filtros);

    if (!result.ok) {
      const error: ApiError = { success: false, error: result.error.message, code: result.error.code };
      res.status(500).json(error);
      return;
    }

    const response: ApiResponse<typeof result.data> = { success: true, data: result.data, meta: result.meta };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

export default router;
