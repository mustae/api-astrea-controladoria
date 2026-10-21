import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  ANGULAR_PAGE_PATH: '/#/main/contacts',
  withBrowserContext: vi.fn(<T>(op: (page: unknown) => Promise<T>) => op({})),
  astreaApiGet: vi.fn(),
}));

vi.mock('../browser/navigator.js', () => ({
  navigateTo: vi.fn().mockResolvedValue(undefined),
}));

import { listarEtiquetas, mapTag, resetarEtiquetasCache } from './etiquetas.service.js';
import { astreaApiGet } from '../browser/astrea-http.js';

const mockGet = vi.mocked(astreaApiGet);

const TAGS = {
  items: [
    { id: '5629499534213120', label: 'URGENTE', color: '#ff0000', active: true },
    { id: '42', label: 'Previdenciário', active: true },
    { id: '43', label: 'Antiga', color: '#ccc', active: false },
  ],
};

beforeEach(() => {
  mockGet.mockReset();
  resetarEtiquetasCache();
});

describe('mapTag', () => {
  it('traduz campos e trata active ausente como ativa', () => {
    expect(mapTag({ id: '1', label: ' X ' })).toEqual({
      id: '1',
      nome: 'X',
      cor: undefined,
      ativa: true,
      restricoes: [],
    });
    expect(
      mapTag({ id: 2 as unknown as string, label: 'Y', color: '#000', active: false, restrictions: ['CASES', 'TASKS'] }),
    ).toEqual({
      id: '2',
      nome: 'Y',
      cor: '#000',
      ativa: false,
      restricoes: ['CASES', 'TASKS'],
    });
  });
});

describe('listarEtiquetas', () => {
  it('chama GET /tags/get-all-tags e devolve só as ativas, ordenadas por nome', async () => {
    mockGet.mockResolvedValueOnce(TAGS);
    const r = await listarEtiquetas();
    expect(mockGet).toHaveBeenCalledWith(expect.anything(), '/tags/get-all-tags');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((e) => e.nome)).toEqual(['Previdenciário', 'URGENTE']);
  });

  it('incluirInativas traz todas', async () => {
    mockGet.mockResolvedValueOnce(TAGS);
    const r = await listarEtiquetas({ incluirInativas: true });
    expect(r.ok && r.data).toHaveLength(3);
  });

  it('filtra por texto (sem acento/caixa)', async () => {
    mockGet.mockResolvedValueOnce(TAGS);
    const r = await listarEtiquetas({ busca: 'previd' });
    expect(r.ok && r.data.map((e) => e.id)).toEqual(['42']);
  });

  it('filtra por uso (restrição): "processos" mantém CASES e as sem restrição', async () => {
    mockGet.mockResolvedValueOnce({
      items: [
        { id: '1', label: 'A', restrictions: ['CASES'] },
        { id: '2', label: 'B', restrictions: ['TASKS'] },
        { id: '3', label: 'C' },
      ],
    });
    const r = await listarEtiquetas({ uso: 'processos' });
    expect(r.ok && r.data.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('usa cache: duas chamadas seguidas = 1 request', async () => {
    mockGet.mockResolvedValue(TAGS);
    await listarEtiquetas();
    await listarEtiquetas({ incluirInativas: true });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('erro do Astrea vira ServiceResponse de erro (não lança)', async () => {
    mockGet.mockRejectedValueOnce(new Error('API_ERROR_500: boom'));
    const r = await listarEtiquetas();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('API_ERROR');
    expect(r.error.message).toContain('boom');
  });

  it('resposta sem items → lista vazia', async () => {
    mockGet.mockResolvedValueOnce({});
    const r = await listarEtiquetas();
    expect(r.ok && r.data).toEqual([]);
  });
});

describe('carregarEtiquetasBrutas', () => {
  it('devolve objetos completos na ordem pedida', async () => {
    const { carregarEtiquetasBrutas } = await import('./etiquetas.service.js');
    mockGet.mockResolvedValueOnce({
      items: [
        { id: '1', label: 'A', color: '#111', active: true, restrictions: ['APPOINTMENTS'] },
        { id: '2', label: 'B' },
      ],
    });
    const r = await carregarEtiquetasBrutas({} as never, ['2', '1']);
    expect(r).toEqual([
      { id: '2', label: 'B', color: '#000000', active: true, hasRestrictions: false, restrictions: [], tagType: 'MANUAL' },
      { id: '1', label: 'A', color: '#111', active: true, hasRestrictions: true, restrictions: ['APPOINTMENTS'], tagType: 'MANUAL' },
    ]);
  });

  it('id inexistente → VALIDATION_ERROR', async () => {
    const { carregarEtiquetasBrutas } = await import('./etiquetas.service.js');
    mockGet.mockResolvedValueOnce({ items: [] });
    await expect(carregarEtiquetasBrutas({} as never, ['9'])).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it('lista vazia não chama o Astrea', async () => {
    const { carregarEtiquetasBrutas } = await import('./etiquetas.service.js');
    expect(await carregarEtiquetasBrutas({} as never, [])).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
