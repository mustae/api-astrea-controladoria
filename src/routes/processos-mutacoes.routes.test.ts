import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../test/helpers/express-app.js';

vi.mock('../services/processos-mutacoes.service.js', () => ({
  etiquetarProcessos: vi.fn(),
  editarProcesso: vi.fn(),
  encerrarProcessos: vi.fn(),
  reativarProcesso: vi.fn(),
  criarAndamento: vi.fn(),
  excluirAndamento: vi.fn(),
  excluirTarefa: vi.fn(),
}));

import router from './processos-mutacoes.routes.js';
import * as svc from '../services/processos-mutacoes.service.js';

const app = buildApp((a) => a.use('/api', router));
const ok = <T>(data: T) => ({ ok: true as const, data });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/casos/etiquetas', () => {
  it('valida body e repassa ao service', async () => {
    vi.mocked(svc.etiquetarProcessos).mockResolvedValueOnce(
      ok({ acao: 'aplicar' as const, total: 1, sucesso: 1, falhas: 0, itens: [] }),
    );
    const r = await request(app)
      .post('/api/casos/etiquetas')
      .send({ processoIds: ['1'], etiquetasIds: ['2'], acao: 'aplicar' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(svc.etiquetarProcessos).toHaveBeenCalledWith({ processoIds: ['1'], etiquetasIds: ['2'], acao: 'aplicar' });
  });

  it('acao ausente → 400 sem chamar o service', async () => {
    const r = await request(app).post('/api/casos/etiquetas').send({ processoIds: ['1'], etiquetasIds: ['2'] });
    expect(r.status).toBe(400);
    expect(svc.etiquetarProcessos).not.toHaveBeenCalled();
  });

  it('lote com falhas parciais → 207', async () => {
    vi.mocked(svc.etiquetarProcessos).mockResolvedValueOnce(
      ok({ acao: 'aplicar' as const, total: 2, sucesso: 1, falhas: 1, itens: [] }),
    );
    const r = await request(app)
      .post('/api/casos/etiquetas')
      .send({ processoIds: ['1', '2'], etiquetasIds: ['3'], acao: 'aplicar' });
    expect(r.status).toBe(207);
  });

  it('VALIDATION_ERROR do service → 400', async () => {
    vi.mocked(svc.etiquetarProcessos).mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'confirmar', retryable: false },
    });
    const r = await request(app)
      .post('/api/casos/etiquetas')
      .send({ processoIds: ['1'], etiquetasIds: ['3'], acao: 'remover' });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
  });
});

describe('PATCH /api/casos/:id', () => {
  it('edita objeto/valor', async () => {
    vi.mocked(svc.editarProcesso).mockResolvedValueOnce(ok({ id: '9', alterados: ['objeto'] }));
    const r = await request(app).patch('/api/casos/9').send({ objeto: 'x' });
    expect(r.status).toBe(200);
    expect(svc.editarProcesso).toHaveBeenCalledWith('9', { objeto: 'x' });
  });

  it('campo desconhecido → 400 (strict)', async () => {
    const r = await request(app).patch('/api/casos/9').send({ tags: [] });
    expect(r.status).toBe(400);
  });
});

describe('encerrar / reativar', () => {
  it('POST /api/casos/encerrar', async () => {
    vi.mocked(svc.encerrarProcessos).mockResolvedValueOnce(ok({ total: 1, sucesso: 1, falhas: 0, itens: [] }));
    const r = await request(app)
      .post('/api/casos/encerrar')
      .send({ processoIds: ['1'], confirmar: true, valorCondenacao: 10 });
    expect(r.status).toBe(200);
    expect(svc.encerrarProcessos).toHaveBeenCalledWith({ processoIds: ['1'], confirmar: true, valorCondenacao: 10 });
  });

  it('POST /api/casos/:id/reativar', async () => {
    vi.mocked(svc.reativarProcesso).mockResolvedValueOnce(ok({ id: '1', reativado: true }));
    const r = await request(app).post('/api/casos/1/reativar');
    expect(r.status).toBe(200);
    expect(svc.reativarProcesso).toHaveBeenCalledWith('1');
  });
});

describe('andamentos e tarefas', () => {
  it('POST /api/casos/:id/andamentos → 201', async () => {
    vi.mocked(svc.criarAndamento).mockResolvedValueOnce(ok({ id: '5', processoId: '1', descricao: 'x' }));
    const r = await request(app).post('/api/casos/1/andamentos').send({ descricao: 'x', data: '2026-10-21' });
    expect(r.status).toBe(201);
    expect(svc.criarAndamento).toHaveBeenCalledWith({ processoId: '1', descricao: 'x', data: '2026-10-21' });
  });

  it('DELETE /api/andamentos/:id', async () => {
    vi.mocked(svc.excluirAndamento).mockResolvedValueOnce(ok({ id: '5', removido: true as const }));
    const r = await request(app).delete('/api/andamentos/5');
    expect(r.status).toBe(200);
  });

  it('DELETE /api/tarefas/:id com NOT_FOUND → 404', async () => {
    vi.mocked(svc.excluirTarefa).mockResolvedValueOnce({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'x', retryable: false },
    });
    const r = await request(app).delete('/api/tarefas/7');
    expect(r.status).toBe(404);
  });
});
