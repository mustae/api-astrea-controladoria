import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({ astreaApiGet: vi.fn() }));

import { comEtiqueta, etiquetaDaAudiencia, limparCacheEtiquetaAutomatica } from './etiqueta-automatica.js';
import { astreaApiGet } from '../browser/astrea-http.js';

const mGet = vi.mocked(astreaApiGet);
const page = {} as never;

const TAGS = {
  items: [
    { id: 5700377679265792, label: '7 PERICLES', active: true, restrictions: ['HEARING'] },
    { id: 6025454386708480, label: 'Audiência', active: true, restrictions: ['TASKS', 'DEADLINE', 'HEARING'] },
    { id: 111, label: 'Só tarefa', active: true, restrictions: ['TASKS'] },
    { id: 222, label: 'Antiga', active: false, restrictions: [] },
  ],
};

beforeEach(() => {
  mGet.mockReset();
  mGet.mockResolvedValue(TAGS);
  limparCacheEtiquetaAutomatica();
});

describe('etiquetaDaAudiencia', () => {
  it('padrão "Audiência": acha por nome sem acento/caixa', async () => {
    expect(await etiquetaDaAudiencia(page)).toBe('6025454386708480');
    expect(await etiquetaDaAudiencia(page, 'audiencia')).toBe('6025454386708480');
    expect(mGet).toHaveBeenCalledWith(page, '/tags/get-all-tags');
  });

  it('aceita id', async () => {
    expect(await etiquetaDaAudiencia(page, '5700377679265792')).toBe('5700377679265792');
  });

  it('"nenhuma" desliga, sem consultar o Astrea', async () => {
    expect(await etiquetaDaAudiencia(page, 'nenhuma')).toBeNull();
    expect(mGet).not.toHaveBeenCalled();
  });

  it('inexistente, inativa ou não permitida em audiência → null (cria sem a etiqueta)', async () => {
    expect(await etiquetaDaAudiencia(page, 'Sumiu')).toBeNull();
    expect(await etiquetaDaAudiencia(page, 'Antiga')).toBeNull();
    expect(await etiquetaDaAudiencia(page, 'Só tarefa')).toBeNull();
  });

  it('lista de etiquetas fica em cache', async () => {
    await etiquetaDaAudiencia(page);
    await etiquetaDaAudiencia(page);
    expect(mGet).toHaveBeenCalledTimes(1);
  });
});

describe('comEtiqueta', () => {
  it('acrescenta sem duplicar; null não muda', () => {
    expect(comEtiqueta(['1'], '2')).toEqual(['1', '2']);
    expect(comEtiqueta(['1', '2'], '2')).toEqual(['1', '2']);
    expect(comEtiqueta(['1'], null)).toEqual(['1']);
  });
});
