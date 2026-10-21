// Rotas de mutação em processos (paridade mcp.ai) — montadas em /api.
// Contratos do Astrea documentados em services/processos-mutacoes.service.ts.

import { Router } from 'express';
import { z } from 'zod';
import {
  criarAndamento,
  editarProcesso,
  encerrarProcessos,
  etiquetarProcessos,
  excluirAndamento,
  etiquetarTarefa,
  excluirTarefa,
  reativarProcesso,
} from '../services/processos-mutacoes.service.js';
import { h, invalido, responder } from './query-helpers.js';

const router = Router();

const ids = z.array(z.string().regex(/^\d+$/, 'ID deve ser numérico')).min(1);

const etiquetarSchema = z
  .object({
    processoIds: ids,
    etiquetasIds: ids,
    acao: z.enum(['aplicar', 'remover']),
    confirmar: z.boolean().optional(),
  })
  .strict();

const editarSchema = z
  .object({
    objeto: z.string().optional(),
    valorCondenacao: z.number().nonnegative().optional(),
    titulo: z.string().min(1).optional(),
  })
  .strict();

const encerrarSchema = z
  .object({
    processoIds: ids,
    valorCondenacao: z.number().nonnegative().optional(),
    desvincularTribunal: z.boolean().optional(),
    confirmar: z.boolean().optional(),
  })
  .strict();

const andamentoSchema = z
  .object({
    descricao: z.string().min(1),
    data: z.string().optional(),
    responsavelId: z.string().regex(/^\d+$/).optional(),
  })
  .strict();

/** POST /api/casos/etiquetas — aplica/remove etiquetas em lote. */
router.post(
  '/casos/etiquetas',
  h(async (req, res) => {
    const p = etiquetarSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await etiquetarProcessos(p.data));
  }),
);

/** POST /api/casos/encerrar — encerra processos em lote (exige confirmar=true). */
router.post(
  '/casos/encerrar',
  h(async (req, res) => {
    const p = encerrarSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await encerrarProcessos(p.data));
  }),
);

/** PATCH /api/casos/:id — edita objeto/valor da condenação/título (read-modify-write). */
router.patch(
  '/casos/:id',
  h(async (req, res) => {
    const p = editarSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await editarProcesso(req.params.id, p.data));
  }),
);

/** POST /api/casos/:id/reativar — reabre processo encerrado (no-op se já ativo). */
router.post(
  '/casos/:id/reativar',
  h(async (req, res) => {
    responder(res, await reativarProcesso(req.params.id));
  }),
);

/** POST /api/casos/:id/andamentos — lança andamento MANUAL. */
router.post(
  '/casos/:id/andamentos',
  h(async (req, res) => {
    const p = andamentoSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await criarAndamento({ processoId: req.params.id, ...p.data }), 201);
  }),
);

/** DELETE /api/andamentos/:id — exclui andamento. */
router.delete(
  '/andamentos/:id',
  h(async (req, res) => {
    responder(res, await excluirAndamento(req.params.id));
  }),
);

/** DELETE /api/tarefas/:id — exclui tarefa (vai para a lixeira do Astrea). */
router.delete(
  '/tarefas/:id',
  h(async (req, res) => {
    responder(res, await excluirTarefa(req.params.id));
  }),
);

const etiquetarTarefaSchema = z
  .object({ etiquetasIds: ids, acao: z.enum(['aplicar', 'remover']) })
  .strict();

/** POST /api/tarefas/:id/etiquetas — aplica/remove etiquetas numa tarefa. */
router.post(
  '/tarefas/:id/etiquetas',
  h(async (req, res) => {
    const p = etiquetarTarefaSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await etiquetarTarefa({ tarefaId: req.params.id, ...p.data }));
  }),
);

export default router;
