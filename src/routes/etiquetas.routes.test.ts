import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../test/helpers/express-app.js';

vi.mock('../services/etiquetas.service.js', () => ({
  listarEtiquetas: vi.fn(),
}));

vi.mock('../services/casos.service.js', () => ({
  criarCaso: vi.fn(),
  criarProcesso: vi.fn(),
  listarCasos: vi.fn(),
  buscarCaso: vi.fn(),
  listarProcessos: vi.fn(),
}));
vi.mock('../services/andamentos.service.js', () => ({ listarAndamentos: vi.fn() }));
vi.mock('../services/processos-estatisticas.service.js', () => ({
  contarProcessos: vi.fn(),
  processosPorCliente: vi.fn(),
}));

import etiquetasRoutes from './etiquetas.routes.js';
import casosRoutes from './casos.routes.js';
import { listarEtiquetas } from '../services/etiquetas.service.js';
import { listarProcessos } from '../services/casos.service.js';
import { contarProcessos, processosPorCliente } from '../services/processos-estatisticas.service.js';

const app = buildApp((a) => {
  a.use('/api/etiquetas', etiquetasRoutes);
  a.use('/api/casos', casosRoutes);
});

beforeEach(() => vi.clearAllMocks());

describe('GET /api/etiquetas', () => {
  it('repassa opções e devolve ApiResponse', async () => {
    vi.mocked(listarEtiquetas).mockResolvedValueOnce({
      ok: true,
      data: [{ id: '1', nome: 'A', ativa: true, restricoes: [] }],
    });
    const r = await request(app).get('/api/etiquetas?busca=a&incluirInativas=true&uso=processos');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: [{ id: '1', nome: 'A', ativa: true, restricoes: [] }] });
    expect(listarEtiquetas).toHaveBeenCalledWith({ busca: 'a', incluirInativas: true, uso: 'processos' });
  });

  it('uso inválido → 400', async () => {
    const r = await request(app).get('/api/etiquetas?uso=xpto');
    expect(r.status).toBe(400);
    expect(listarEtiquetas).not.toHaveBeenCalled();
  });

  it('erro do service → 500 com code', async () => {
    vi.mocked(listarEtiquetas).mockResolvedValueOnce({
      ok: false,
      error: { message: 'boom', code: 'API_ERROR', retryable: false },
    });
    const r = await request(app).get('/api/etiquetas');
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ success: false, code: 'API_ERROR' });
  });
});

describe('GET /api/casos/processos/contagem', () => {
  it('aceita etiquetasIds em CSV e devolve total', async () => {
    vi.mocked(contarProcessos).mockResolvedValueOnce({ ok: true, data: { total: 7 } });
    const r = await request(app).get('/api/casos/processos/contagem?tipo=processo&etiquetasIds=1,2');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { total: 7 } });
    expect(contarProcessos).toHaveBeenCalledWith({ tipo: 'processo', etiquetasIds: ['1', '2'] });
  });

  it('VALIDATION_ERROR do service → 400', async () => {
    vi.mocked(contarProcessos).mockResolvedValueOnce({
      ok: false,
      error: { message: 'VALIDATION_ERROR: x', code: 'VALIDATION_ERROR', retryable: false },
    });
    const r = await request(app).get('/api/casos/processos/contagem?etiquetasIds=abc');
    expect(r.status).toBe(400);
  });
});

describe('GET /api/casos/processos/por-cliente', () => {
  it('repassa filtros e topN/maxProcessos', async () => {
    const data = { totalProcessos: 1, totalClientes: 1, semCliente: 0, truncado: false, clientes: [] };
    vi.mocked(processosPorCliente).mockResolvedValueOnce({ ok: true, data });
    const r = await request(app).get('/api/casos/processos/por-cliente?status=todos&topN=5&maxProcessos=300');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(data);
    expect(processosPorCliente).toHaveBeenCalledWith({ status: 'todos' }, { topN: 5, maxProcessos: 300 });
  });
});

describe('GET /api/casos/processos (filtro de etiquetas)', () => {
  it('passa etiquetasIds e clienteIds ao listarProcessos', async () => {
    vi.mocked(listarProcessos).mockResolvedValueOnce({ ok: true, data: [] });
    const r = await request(app).get('/api/casos/processos?etiquetasIds=9&etiquetasIds=8&clienteIds=5');
    expect(r.status).toBe(200);
    expect(listarProcessos).toHaveBeenCalledWith(
      expect.objectContaining({ etiquetasIds: ['9', '8'], clienteIds: ['5'] }),
    );
  });
});
