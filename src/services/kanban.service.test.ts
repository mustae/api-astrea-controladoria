import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  ANGULAR_PAGE_PATH: '/#/main/contacts',
  withBrowserContext: vi.fn(<T>(op: (page: unknown) => Promise<T>) => op({})),
  astreaApiGet: vi.fn(),
  astreaApiPost: vi.fn(),
  astreaApiPut: vi.fn(),
}));
vi.mock('../browser/navigator.js', () => ({ navigateTo: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./usuarios.service.js', () => ({ listarUsuarios: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));

import { listarAtividadesQuadro } from './kanban.service.js';
import { astreaApiGet, astreaApiPost } from '../browser/astrea-http.js';

const mGet = vi.mocked(astreaApiGet);
const mPost = vi.mocked(astreaApiPost);
const QUADRO = '6480689026334720';
const COLUNA = '5124495716155392';

beforeEach(() => {
  mGet.mockReset();
  mPost.mockReset();
});

describe('listarAtividadesQuadro — etiquetas do card', () => {
  it('expõe tagIds do Astrea como etiquetasIds (strings), [] quando ausente', async () => {
    mGet.mockResolvedValueOnce([{ id: QUADRO, name: 'Kanban Padrão', default: true, columns: [{ id: COLUNA, name: 'A Fazer', type: 'BACKLOG' }] }]);
    mPost.mockResolvedValueOnce({
      activities: [
        { id: 1, type: 'DEADLINE', title: 'P', tagIds: [5023924196245504], kanbanDetails: { id: QUADRO, columnId: COLUNA } },
        { id: 2, type: 'TASK', title: 'T', kanbanDetails: { id: QUADRO, columnId: COLUNA } },
      ],
      hasMore: false,
    });
    const r = await listarAtividadesQuadro(QUADRO, { prazoInicio: '2026-10-01', prazoFim: '2026-10-31' });
    expect(r.ok).toBe(true);
    const atividades = r.ok ? r.data.colunas[0].atividades : [];
    expect(atividades.map((a) => [a.tipo, a.etiquetasIds])).toEqual([
      ['DEADLINE', ['5023924196245504']],
      ['TASK', []],
    ]);
  });
});
