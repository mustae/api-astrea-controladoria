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

import { atualizarTarefa } from './tarefas.service.js';
import { limparCacheQuadrosKanban } from './kanban-destino.js';
import { astreaApiGet, gapiCall } from '../browser/astrea-http.js';

const mGapi = vi.mocked(gapiCall);
const mGet = vi.mocked(astreaApiGet);
const QUADROS = [
  { id: 6480689026334720, name: 'Kanban Padrão', default: true, columns: [{ id: 5124495716155392, name: 'A Fazer', type: 'BACKLOG' }] },
  { id: 6424975299870720, name: 'Mateus Iniciais', default: false, columns: [{ id: 6057990779076608, name: 'Aguardando Redação', type: 'BACKLOG' }] },
];
const MATEUS = { quadroId: '6424975299870720', quadroNome: 'Mateus Iniciais', colunaId: '6057990779076608', colunaNome: 'Aguardando Redação' };

// Formato de getTaskWithComments observado em 26/10/2026 (tarefa com prazo, etiqueta e Kanban).
const ATUAL = {
  id: '5818958958854144',
  version: 3,
  description: 'Tarefa',
  done: false,
  dueDate: '2026-10-27T09:00:00.000Z',
  responsibleId: '6537740792659968',
  ownerId: '6537740792659968',
  createDate: '2026-10-26T17:33:40.892Z',
  priority: 0,
  caseId: '4959517162110976',
  currentTaskList: '5927732895842304',
  tagIds: ['5023924196245504'],
  kanbanDetails: { id: '6480689026334720', columnId: '5124495716155392' },
};

function taskInfo(): Record<string, unknown> {
  return (mGapi.mock.calls[1][4] as { taskInfoDTO: Record<string, unknown> }).taskInfoDTO;
}

beforeEach(() => {
  mGapi.mockReset();
  mGapi.mockResolvedValueOnce(ATUAL).mockResolvedValueOnce({});
  mGet.mockReset();
  mGet.mockResolvedValue(QUADROS);
  limparCacheQuadrosKanban();
});

describe('atualizarTarefa', () => {
  it('regressão: reenvia o prazo atual como YYYY-MM-DD (ISO completo o Astrea recusa com NumberFormatException)', async () => {
    const r = await atualizarTarefa('5818958958854144', { titulo: 'Novo' });
    expect(r.ok).toBe(true);
    expect(taskInfo()).toMatchObject({ id: '5818958958854144', version: 3, description: 'Novo', dueDate: '2026-10-27' });
  });

  it('preserva etiquetas e Kanban atuais', async () => {
    await atualizarTarefa('5818958958854144', { titulo: 'Novo' });
    expect(taskInfo()).toMatchObject({
      tagIds: ['5023924196245504'],
      kanbanId: '6480689026334720',
      kanbanColumnId: '5124495716155392',
      kanbanDetails: { id: '6480689026334720', columnId: '5124495716155392' },
    });
  });

  it('kanban { quadro } troca o quadro (1ª coluna) e devolve o destino', async () => {
    const r = await atualizarTarefa('5818958958854144', { kanban: { quadro: 'Mateus Iniciais' } });
    expect(taskInfo()).toMatchObject({ kanbanId: MATEUS.quadroId, kanbanColumnId: MATEUS.colunaId });
    expect(r.ok && r.data.kanban).toEqual(MATEUS);
  });

  it('kanban: false tira do Kanban (kanbanDetails null, sem kanbanId)', async () => {
    const r = await atualizarTarefa('5818958958854144', { kanban: false });
    expect(taskInfo().kanbanDetails).toBeNull();
    expect(taskInfo()).not.toHaveProperty('kanbanId');
    expect(r.ok && r.data.kanban).toBeNull();
  });

  it('kanban em tarefa sem prazo → VALIDATION_ERROR sem salvar', async () => {
    mGapi.mockReset();
    mGapi.mockResolvedValueOnce({ ...ATUAL, dueDate: undefined, kanbanDetails: {} });
    const r = await atualizarTarefa('5818958958854144', { kanban: { quadro: 'Mateus Iniciais' } });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mGapi).toHaveBeenCalledTimes(1);
  });

  it('quadro inexistente → VALIDATION_ERROR', async () => {
    const r = await atualizarTarefa('5818958958854144', { kanban: { quadro: 'Sumiu' } });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
  });
});
