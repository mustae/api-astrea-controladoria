import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../test/helpers/express-app.js';
import { errorHandler } from '../middleware/error-handler.js';

vi.mock('../services/tarefas.service.js', () => ({
  listarTarefas: vi.fn(),
  buscarTarefasPorProcesso: vi.fn(),
  criarTarefa: vi.fn(),
  comentarTarefa: vi.fn(),
  atualizarTarefa: vi.fn(),
}));

import router from './tarefas.routes.js';
import { atualizarTarefa, criarTarefa } from '../services/tarefas.service.js';

const app = buildApp((a) => {
  a.use('/api/tarefas', router);
  a.use(errorHandler);
});
const mCriar = vi.mocked(criarTarefa);
const mAtualizar = vi.mocked(atualizarTarefa);
const KANBAN = { quadro: 'Mateus Iniciais', coluna: 'Aguardando Redação' };
const CORPO = { titulo: 't', responsavelId: '6537740792659968', prazo: '2026-10-24' };

beforeEach(() => vi.clearAllMocks());

describe('POST /api/tarefas — responsável', () => {
  it('responsavelId é opcional (regra pela etiqueta de área no service)', async () => {
    mCriar.mockResolvedValueOnce({ ok: true, data: { id: '1', titulo: 't', status: 'pendente' } });
    const r = await request(app).post('/api/tarefas').send({ titulo: 't', casoId: '9' });
    expect(r.status).toBe(201);
    expect(mCriar).toHaveBeenCalledWith({ titulo: 't', casoId: '9' });
  });
});

describe('POST /api/tarefas — kanban', () => {
  it('kanban { quadroId, colunaId } chega ao service', async () => {
    mCriar.mockResolvedValueOnce({ ok: true, data: { id: '1', titulo: 't', status: 'pendente' } });
    const r = await request(app).post('/api/tarefas').send({ ...CORPO, kanban: KANBAN });
    expect(r.status).toBe(201);
    expect(mCriar).toHaveBeenCalledWith(expect.objectContaining({ kanban: KANBAN }));
  });

  it('kanban: false é aceito', async () => {
    mCriar.mockResolvedValueOnce({ ok: true, data: { id: '1', titulo: 't', status: 'pendente', kanban: null } });
    const r = await request(app).post('/api/tarefas').send({ ...CORPO, kanban: false });
    expect(r.status).toBe(201);
    expect(mCriar).toHaveBeenCalledWith(expect.objectContaining({ kanban: false }));
  });

  it('kanban sem quadro → 400 sem chamar o service', async () => {
    const r = await request(app).post('/api/tarefas').send({ ...CORPO, kanban: { coluna: 'A Fazer' } });
    expect(r.status).toBe(400);
    expect(mCriar).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tarefas/:id — kanban', () => {
  it('kanban { quadro } ou false chega ao service', async () => {
    mAtualizar.mockResolvedValue({ ok: true, data: { id: '1', titulo: 't', status: 'pendente', kanban: null } });
    expect((await request(app).patch('/api/tarefas/1').send({ kanban: KANBAN })).status).toBe(200);
    expect(mAtualizar).toHaveBeenLastCalledWith('1', { kanban: KANBAN });
    expect((await request(app).patch('/api/tarefas/1').send({ kanban: false })).status).toBe(200);
    expect(mAtualizar).toHaveBeenLastCalledWith('1', { kanban: false });
  });

  it('kanban sem quadro → 400 sem chamar o service; VALIDATION_ERROR do service → 400', async () => {
    expect((await request(app).patch('/api/tarefas/1').send({ kanban: { coluna: 'x' } })).status).toBe(400);
    expect(mAtualizar).not.toHaveBeenCalled();
    mAtualizar.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'kanban exige prazo na tarefa', retryable: false } });
    const r = await request(app).patch('/api/tarefas/1').send({ kanban: KANBAN });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/exige prazo/);
  });
});
