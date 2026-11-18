import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  ANGULAR_PAGE_PATH: '/#/main/contacts',
  WORKSPACE_PAGE_PATH: '/#/main/workspace/%5B,%5D',
  withBrowserContext: vi.fn(<T>(op: (page: unknown) => Promise<T>) => op({})),
  gapiCall: vi.fn(),
  astreaGapiGet: vi.fn(),
  astreaApiGet: vi.fn(),
  getAstreaUserId: vi.fn().mockResolvedValue('6537740792659968'),
}));
vi.mock('../browser/navigator.js', () => ({ navigateTo: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./usuarios.service.js', () => ({
  listarUsuarios: vi.fn().mockResolvedValue({ ok: true, data: [{ id: '22', nome: 'Mariane Souza', email: 'mariane@srsadvogados.adv.br' }] }),
}));

import { criarTarefa } from './tarefas.service.js';
import { limparCacheQuadrosKanban } from './kanban-destino.js';
import { limparCacheEtiquetaAutomatica } from './etiqueta-automatica.js';
import { astreaApiGet, gapiCall } from '../browser/astrea-http.js';

const mGapi = vi.mocked(gapiCall);
const mGet = vi.mocked(astreaApiGet);
const USER = '6537740792659968';
const QUADROS = [
  { id: 6480689026334720, name: 'Kanban Padrão', default: true, columns: [{ id: 5124495716155392, name: 'A Fazer', type: 'BACKLOG' }] },
  { id: 6424975299870720, name: 'Mateus Iniciais', default: false, columns: [{ id: 6057990779076608, name: 'Aguardando Redação', type: 'BACKLOG' }] },
];
const PADRAO = { quadroId: '6480689026334720', quadroNome: 'Kanban Padrão', colunaId: '5124495716155392', colunaNome: 'A Fazer' };

function taskInfo(): Record<string, unknown> {
  return (mGapi.mock.calls[1][4] as { taskInfoDTO: Record<string, unknown> }).taskInfoDTO;
}

beforeEach(() => {
  mGapi.mockReset();
  mGapi.mockResolvedValueOnce([{ id: '1' }]).mockResolvedValueOnce({ id: '2' });
  mGet.mockReset();
  mGet.mockResolvedValue(QUADROS);
  limparCacheQuadrosKanban();
  limparCacheEtiquetaAutomatica();
});

describe('criarTarefa no Kanban', () => {
  it('com prazo e sem pedido → quadro padrão (regra de fábrica KANBAN_TAREFA=padrao)', async () => {
    const r = await criarTarefa({ titulo: 't', responsavelId: USER, prazo: '2026-10-24' });
    expect(taskInfo()).toMatchObject({
      kanbanId: PADRAO.quadroId,
      kanbanColumnId: PADRAO.colunaId,
      kanbanDetails: { id: PADRAO.quadroId, columnId: PADRAO.colunaId },
    });
    expect(r.ok && r.data.kanban).toEqual(PADRAO);
  });

  it('pedido por nome troca o quadro', async () => {
    const r = await criarTarefa({ titulo: 't', responsavelId: USER, prazo: '2026-10-24', kanban: { quadro: 'Mateus Iniciais' } });
    expect(taskInfo()).toMatchObject({ kanbanId: '6424975299870720', kanbanColumnId: '6057990779076608' });
    expect(r.ok && r.data.kanban?.quadroNome).toBe('Mateus Iniciais');
  });

  it('kanban: false → fora do Kanban', async () => {
    const r = await criarTarefa({ titulo: 't', responsavelId: USER, prazo: '2026-10-24', kanban: false });
    expect(taskInfo()).not.toHaveProperty('kanbanId');
    expect(r.ok && r.data.kanban).toBeNull();
  });

  it('sem prazo e sem pedido → fora do Kanban, sem erro e sem consultar quadros', async () => {
    const r = await criarTarefa({ titulo: 't', responsavelId: USER });
    expect(r.ok).toBe(true);
    expect(taskInfo()).not.toHaveProperty('kanbanId');
    expect(mGet).not.toHaveBeenCalled();
  });

  it('pedido explícito sem prazo → VALIDATION_ERROR antes de abrir o browser', async () => {
    const r = await criarTarefa({ titulo: 't', responsavelId: USER, kanban: { quadro: 'Kanban Padrão' } });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mGapi).not.toHaveBeenCalled();
  });

  it('quadro inexistente → VALIDATION_ERROR e a tarefa não é salva', async () => {
    const r = await criarTarefa({ titulo: 't', responsavelId: USER, prazo: '2026-10-24', kanban: { quadro: 'Sumiu' } });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mGapi.mock.calls.some((c) => c[2] === 'saveTaskWithList')).toBe(false);
  });
});

describe('criarTarefa — regras pela natureza', () => {
  const CASO = '4959517162110976';
  const SINDISMED = { id: 5924009773662208, name: 'Demandas do SINDISMED', default: false, columns: [{ id: 77, name: 'Recebidas' }] };
  function processo(folder: unknown) {
    mGet.mockImplementation(async (_p: unknown, path: string) => {
      if (path === '/kanbans') return [...QUADROS, SINDISMED] as never;
      if (path === '/tags/get-all-tags') return { items: [{ id: 5, label: 'Previdenciário', active: true }] } as never;
      if (path.startsWith(`/folder/${CASO}`)) return folder as never;
      return undefined as never;
    });
  }

  it('sem responsavelId, processo previdenciário do SINDISMED → Mariane e Demandas do SINDISMED', async () => {
    processo({ tagIds: [5], customers: [{ name: 'Sindismed' }] });
    const r = await criarTarefa({ titulo: 't', casoId: CASO, prazo: '2026-10-24' });
    expect(taskInfo()).toMatchObject({ responsibleId: '22', kanbanId: '5924009773662208', kanbanColumnId: '77' });
    expect((mGapi.mock.calls[1][4] as { responsibleId: string }).responsibleId).toBe('22');
    expect(r.ok && r.data.kanban?.quadroNome).toBe('Demandas do SINDISMED');
  });

  it('sem responsavelId e sem regra → usuário da integração', async () => {
    processo({ tagIds: [], customers: [] });
    await criarTarefa({ titulo: 't', casoId: CASO });
    expect(taskInfo()).toMatchObject({ responsibleId: USER });
  });

  it('responsavelId informado vence a regra', async () => {
    processo({ tagIds: [5], customers: [] });
    await criarTarefa({ titulo: 't', casoId: CASO, responsavelId: USER });
    expect(taskInfo()).toMatchObject({ responsibleId: USER });
  });
});

describe('criarTarefa e o pool', () => {
  it('carrega usuários antes de ocupar a aba e marca escrita (timeout não duplica a tarefa)', async () => {
    const { withBrowserContext } = await import('../browser/astrea-http.js');
    const { listarUsuarios } = await import('./usuarios.service.js');
    vi.mocked(withBrowserContext).mockClear();
    vi.mocked(listarUsuarios).mockClear();
    await criarTarefa({ titulo: 't', prazo: '2026-10-24' });
    expect(vi.mocked(listarUsuarios).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(withBrowserContext).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(withBrowserContext).mock.calls[0][1]).toEqual({ escrita: true });
  });
});
