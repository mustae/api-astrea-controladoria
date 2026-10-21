import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  ANGULAR_PAGE_PATH: '/#/main/contacts',
  withBrowserContext: vi.fn(<T>(op: (page: unknown) => Promise<T>) => op({})),
  astreaApiPost: vi.fn(),
  getAstreaUserId: vi.fn().mockResolvedValue('6528036269752320'),
}));

vi.mock('../browser/navigator.js', () => ({
  navigateTo: vi.fn().mockResolvedValue(undefined),
}));

import { contarProcessos, processosNovosPorMes, processosPorCliente } from './processos-estatisticas.service.js';
import { astreaApiPost } from '../browser/astrea-http.js';

const mockPost = vi.mocked(astreaApiPost);

beforeEach(() => {
  mockPost.mockReset();
});

function caso(id: number, clienteId?: number, nome?: string) {
  return {
    id,
    type: 'CTE_LAWSUIT',
    title: `P${id}`,
    customers: clienteId ? [{ id: clienteId, name: nome, main: true }] : [],
  };
}

describe('contarProcessos', () => {
  it('chama /case-list/count com o queryDTO dos filtros e devolve o total', async () => {
    mockPost.mockResolvedValueOnce({ count: 1234 });
    const r = await contarProcessos({ tipo: 'processo', etiquetasIds: ['42'] });
    expect(r).toEqual({ ok: true, data: { total: 1234 } });
    const [, path, body] = mockPost.mock.calls[0];
    expect(path).toBe('/case-list/count');
    expect(body).toMatchObject({
      userId: 6528036269752320,
      queryDTO: { types: ['CTE_LAWSUIT'], tagIds: [42], status: 'Active' },
    });
  });

  it('count ausente → erro API_ERROR (não inventa zero)', async () => {
    mockPost.mockResolvedValueOnce({});
    const r = await contarProcessos();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('API_ERROR');
  });

  it('id de etiqueta inválido → VALIDATION_ERROR sem chamar o Astrea', async () => {
    const r = await contarProcessos({ etiquetasIds: ['abc'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('VALIDATION_ERROR');
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('processosPorCliente', () => {
  it('pagina por cursor, agrupa pelo cliente principal e ordena por quantidade', async () => {
    const pagina1 = Array.from({ length: 100 }, (_, i) => caso(i + 1, i < 60 ? 10 : 20, i < 60 ? 'Ana' : 'Bruno'));
    mockPost
      .mockResolvedValueOnce({ cases: pagina1, cursor: 'c2' })
      .mockResolvedValueOnce({ cases: [caso(101, 30, 'Carla'), caso(102)], cursor: '' });

    const r = await processosPorCliente({}, { topN: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[1][2]).toMatchObject({ queryCursor: 'c2' });

    expect(r.data.totalProcessos).toBe(102);
    expect(r.data.totalClientes).toBe(3);
    expect(r.data.semCliente).toBe(1);
    expect(r.data.truncado).toBe(false);
    expect(r.data.clientes).toEqual([
      { clienteId: '10', clienteNome: 'Ana', quantidade: 60 },
      { clienteId: '20', clienteNome: 'Bruno', quantidade: 40 },
    ]);
  });

  it('respeita maxProcessos e marca truncado', async () => {
    const cheia = Array.from({ length: 100 }, (_, i) => caso(i, 1, 'X'));
    mockPost.mockResolvedValue({ cases: cheia, cursor: 'mais' });
    const r = await processosPorCliente({}, { maxProcessos: 200 });
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(r.ok && r.data.truncado).toBe(true);
    expect(r.ok && r.data.totalProcessos).toBe(200);
  });

  it('cai para customerId/customer quando não há customers[]', async () => {
    mockPost.mockResolvedValueOnce({
      cases: [{ id: 1, customerId: 9, customer: 'Davi' }],
    });
    const r = await processosPorCliente();
    expect(r.ok && r.data.clientes).toEqual([{ clienteId: '9', clienteNome: 'Davi', quantidade: 1 }]);
  });

  it('erro do Astrea vira ServiceResponse de erro', async () => {
    mockPost.mockRejectedValueOnce(new Error('API_ERROR_500: falhou'));
    const r = await processosPorCliente();
    expect(r.ok).toBe(false);
  });
});

describe('processosNovosPorMes', () => {
  it('1 count por mês com fromDate/toDate (meia-noite de Brasília), status todos por padrão', async () => {
    mockPost.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 7 });
    const r = await processosNovosPorMes({}, { meses: 2, ate: '2026-10' });

    expect(mockPost).toHaveBeenCalledTimes(2);
    const dto1 = (mockPost.mock.calls[0][2] as { queryDTO: Record<string, unknown> }).queryDTO;
    expect(mockPost.mock.calls[0][1]).toBe('/case-list/count');
    expect(dto1).toMatchObject({
      createddate: null,
      fromDate: '2026-09-01T03:00:00.000Z',
      toDate: '2026-09-30T03:00:00.000Z',
      status: null,
    });
    const dto2 = (mockPost.mock.calls[1][2] as { queryDTO: Record<string, unknown> }).queryDTO;
    expect(dto2).toMatchObject({ fromDate: '2026-10-01T03:00:00.000Z', toDate: '2026-10-31T03:00:00.000Z' });
    expect(r).toEqual({
      ok: true,
      data: { total: 10, meses: [{ mes: '2026-09', total: 3 }, { mes: '2026-10', total: 7 }] },
    });
  });

  it('virada de ano e fevereiro', async () => {
    mockPost.mockResolvedValue({ count: 0 });
    await processosNovosPorMes({ status: 'ativo' }, { meses: 2, ate: '2028-02' });
    const d = mockPost.mock.calls.map((c) => (c[2] as { queryDTO: Record<string, unknown> }).queryDTO);
    expect(d[0]).toMatchObject({ fromDate: '2028-01-01T03:00:00.000Z', toDate: '2028-01-31T03:00:00.000Z', status: 'Active' });
    expect(d[1]).toMatchObject({ fromDate: '2028-02-01T03:00:00.000Z', toDate: '2028-02-29T03:00:00.000Z' });
  });

  it('meses fora de 1..36 ou ate inválido → VALIDATION_ERROR', async () => {
    expect((await processosNovosPorMes({}, { meses: 0 })).ok).toBe(false);
    expect((await processosNovosPorMes({}, { ate: '2026-13' })).ok).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
