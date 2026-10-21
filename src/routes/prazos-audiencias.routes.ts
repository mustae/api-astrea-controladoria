// Rotas de PRAZOS e AUDIÊNCIAS — montadas em /api.
// Contratos do Astrea em services/prazos-audiencias.service.ts.

import { Router } from 'express';
import { z } from 'zod';
import {
  alterarStatusPrazo,
  buscarAudiencia,
  buscarPrazo,
  criarAudiencia,
  criarPrazo,
  editarAudiencia,
  editarPrazo,
  excluirAudiencia,
  excluirPrazo,
} from '../services/prazos-audiencias.service.js';
import { h, invalido, responder } from './query-helpers.js';

const router = Router();

const id = z.string().regex(/^\d+$/, 'ID deve ser numérico');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:mm');

const prazoBase = {
  titulo: z.string().trim().min(1).max(300),
  data,
  responsavelId: id.optional(),
  etiquetasIds: z.array(id).max(20).optional(),
  observacoes: z.string().max(4000).optional(),
};
const criarPrazoSchema = z.object(prazoBase).strict();
const editarPrazoSchema = z
  .object({ ...prazoBase, titulo: prazoBase.titulo.optional(), data: data.optional() })
  .strict();

const audienciaBase = {
  titulo: z.string().trim().min(1).max(300),
  data,
  horaInicio: hora,
  horaFim: hora.optional(),
  responsavelId: id.optional(),
  forum: z.string().max(300).optional(),
  sala: z.string().max(200).optional(),
  endereco: z.string().max(500).optional(),
  modalidade: z.enum(['presencial', 'remoto']).optional(),
  etiquetasIds: z.array(id).max(20).optional(),
  observacoes: z.string().max(4000).optional(),
  verificarConflito: z.boolean().optional(),
};
const criarAudienciaSchema = z.object(audienciaBase).strict();
const editarAudienciaSchema = z
  .object({
    ...audienciaBase,
    titulo: audienciaBase.titulo.optional(),
    data: data.optional(),
    horaInicio: hora.optional(),
  })
  .strict();

// ── Prazos ──────────────────────────────────────────────────────────────────

/** POST /api/casos/:id/prazos — cria prazo no processo. */
router.post(
  '/casos/:id/prazos',
  h(async (req, res) => {
    const p = criarPrazoSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await criarPrazo({ processoId: req.params.id, ...p.data }), 201);
  }),
);

router.get(
  '/prazos/:id',
  h(async (req, res) => responder(res, await buscarPrazo(req.params.id))),
);

router.patch(
  '/prazos/:id',
  h(async (req, res) => {
    const p = editarPrazoSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await editarPrazo(req.params.id, p.data));
  }),
);

/** POST /api/prazos/:id/concluir — marca como cumprido ({ motivo? }). */
router.post(
  '/prazos/:id/concluir',
  h(async (req, res) => {
    const p = z.object({ motivo: z.string().max(500).optional() }).strict().safeParse(req.body ?? {});
    if (!p.success) return invalido(res, p.error);
    responder(res, await alterarStatusPrazo(req.params.id, { concluido: true, motivo: p.data.motivo }));
  }),
);

/** POST /api/prazos/:id/reabrir — volta para pendente. */
router.post(
  '/prazos/:id/reabrir',
  h(async (req, res) => responder(res, await alterarStatusPrazo(req.params.id, { concluido: false }))),
);

router.delete(
  '/prazos/:id',
  h(async (req, res) => responder(res, await excluirPrazo(req.params.id))),
);

// ── Audiências ──────────────────────────────────────────────────────────────

/** POST /api/casos/:id/audiencias — cria audiência (409 se houver conflito de agenda). */
router.post(
  '/casos/:id/audiencias',
  h(async (req, res) => {
    const p = criarAudienciaSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await criarAudiencia({ processoId: req.params.id, ...p.data }), 201);
  }),
);

router.get(
  '/audiencias/:id',
  h(async (req, res) => responder(res, await buscarAudiencia(req.params.id))),
);

router.patch(
  '/audiencias/:id',
  h(async (req, res) => {
    const p = editarAudienciaSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    responder(res, await editarAudiencia(req.params.id, p.data));
  }),
);

router.delete(
  '/audiencias/:id',
  h(async (req, res) => responder(res, await excluirAudiencia(req.params.id))),
);

export default router;
