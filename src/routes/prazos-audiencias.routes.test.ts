import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../test/helpers/express-app.js';

vi.mock('../services/prazos-audiencias.service.js', () => ({
  alterarStatusPrazo: vi.fn(),
  buscarAudiencia: vi.fn(),
  buscarPrazo: vi.fn(),
  criarAudiencia: vi.fn(),
  criarPrazo: vi.fn(),
  editarAudiencia: vi.fn(),
  editarPrazo: vi.fn(),
  excluirAudiencia: vi.fn(),
  excluirPrazo: vi.fn(),
}));

import router from './prazos-audiencias.routes.js';
import * as svc from '../services/prazos-audiencias.service.js';

const app = buildApp((a) => a.use('/api', router));
const ok = <T>(data: T) => ({ ok: true as const, data });

beforeEach(() => vi.clearAllMocks());

describe('prazos', () => {
  it('POST /api/casos/:id/prazos → 201', async () => {
    vi.mocked(svc.criarPrazo).mockResolvedValueOnce(ok({ id: '1', processoId: '9', titulo: 't', data: '2026-10-22' }));
    const r = await request(app).post('/api/casos/9/prazos').send({ titulo: 't', data: '2026-10-22', etiquetasIds: ['5'] });
    expect(r.status).toBe(201);
    expect(svc.criarPrazo).toHaveBeenCalledWith({ processoId: '9', titulo: 't', data: '2026-10-22', etiquetasIds: ['5'] });
  });

  it('data inválida → 400', async () => {
    const r = await request(app).post('/api/casos/9/prazos').send({ titulo: 't', data: '22/10/2026' });
    expect(r.status).toBe(400);
    expect(svc.criarPrazo).not.toHaveBeenCalled();
  });

  it('concluir / reabrir / excluir', async () => {
    vi.mocked(svc.alterarStatusPrazo).mockResolvedValue(ok({ id: '1', status: 'concluido' as const }));
    vi.mocked(svc.excluirPrazo).mockResolvedValue(ok({ id: '1', removido: true as const }));
    expect((await request(app).post('/api/prazos/1/concluir').send({ motivo: 'Cumprido' })).status).toBe(200);
    expect(svc.alterarStatusPrazo).toHaveBeenLastCalledWith('1', { concluido: true, motivo: 'Cumprido' });
    expect((await request(app).post('/api/prazos/1/reabrir')).status).toBe(200);
    expect(svc.alterarStatusPrazo).toHaveBeenLastCalledWith('1', { concluido: false });
    expect((await request(app).delete('/api/prazos/1')).status).toBe(200);
  });

  it('PATCH /api/prazos/:id aceita campos parciais', async () => {
    vi.mocked(svc.editarPrazo).mockResolvedValueOnce(ok({ id: '1', alterados: ['data'] }));
    const r = await request(app).patch('/api/prazos/1').send({ data: '2026-10-23' });
    expect(r.status).toBe(200);
    expect(svc.editarPrazo).toHaveBeenCalledWith('1', { data: '2026-10-23' });
  });
});

describe('audiências', () => {
  it('POST /api/casos/:id/audiencias → 201', async () => {
    vi.mocked(svc.criarAudiencia).mockResolvedValueOnce(
      ok({ id: '7', processoId: '9', data: '2026-10-22', horaInicio: '13:00', horaFim: '13:30' }),
    );
    const r = await request(app)
      .post('/api/casos/9/audiencias')
      .send({ titulo: 'Conciliação', data: '2026-10-22', horaInicio: '13:00', forum: 'Toledo' });
    expect(r.status).toBe(201);
  });

  it('CONFLICT → 409 com details', async () => {
    vi.mocked(svc.criarAudiencia).mockResolvedValueOnce({
      ok: false,
      error: { code: 'CONFLICT', message: 'ocupado', retryable: false, details: { conflitos: [1] } },
    });
    const r = await request(app)
      .post('/api/casos/9/audiencias')
      .send({ titulo: 'x', data: '2026-10-22', horaInicio: '13:00' });
    expect(r.status).toBe(409);
    expect(r.body.details).toEqual({ conflitos: [1] });
  });

  it('hora inválida → 400; PATCH e DELETE', async () => {
    expect((await request(app).post('/api/casos/9/audiencias').send({ titulo: 'x', data: '2026-10-22', horaInicio: '25:00' })).status).toBe(400);
    vi.mocked(svc.editarAudiencia).mockResolvedValueOnce(ok({ id: '7', alterados: ['horaInicio'] }));
    expect((await request(app).patch('/api/audiencias/7').send({ horaInicio: '14:00' })).status).toBe(200);
    vi.mocked(svc.excluirAudiencia).mockResolvedValueOnce(ok({ id: '7', removido: true as const }));
    expect((await request(app).delete('/api/audiencias/7')).status).toBe(200);
  });
});
