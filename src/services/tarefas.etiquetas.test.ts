import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  ANGULAR_PAGE_PATH: '/#/main/contacts',
  WORKSPACE_PAGE_PATH: '/#/main/workspace/%5B,%5D',
  withBrowserContext: vi.fn(<T>(op: (page: unknown) => Promise<T>) => op({})),
  gapiCall: vi.fn(),
  astreaGapiGet: vi.fn(),
  getAstreaUserId: vi.fn().mockResolvedValue('6537740792659968'),
}));
vi.mock('../browser/navigator.js', () => ({ navigateTo: vi.fn().mockResolvedValue(undefined) }));

import { criarTarefa } from './tarefas.service.js';
import { etiquetarTarefa } from './processos-mutacoes.service.js';
import { astreaGapiGet, gapiCall } from '../browser/astrea-http.js';

const mGapi = vi.mocked(gapiCall);
const mGet = vi.mocked(astreaGapiGet);
const USER = '6537740792659968';

beforeEach(() => {
  mGapi.mockReset();
  mGet.mockReset();
});

describe('criarTarefa com etiquetas', () => {
  it('envia taskInfoDTO.tagIds como strings', async () => {
    mGapi.mockResolvedValueOnce([{ id: '5927732895842304' }]).mockResolvedValueOnce({ id: '1' });
    await criarTarefa({ titulo: 't', responsavelId: USER, casoId: '4959517162110976', etiquetasIds: ['6168384449937408'] });
    const payload = mGapi.mock.calls[1][4] as { taskInfoDTO: Record<string, unknown> };
    expect(mGapi.mock.calls[1][2]).toBe('saveTaskWithList');
    expect(payload.taskInfoDTO.tagIds).toEqual(['6168384449937408']);
  });

  it('sem etiquetas não envia tagIds (comportamento anterior)', async () => {
    mGapi.mockResolvedValueOnce([{ id: '1' }]).mockResolvedValueOnce({ id: '1' });
    await criarTarefa({ titulo: 't', responsavelId: USER });
    const payload = mGapi.mock.calls[1][4] as { taskInfoDTO: Record<string, unknown> };
    expect(payload.taskInfoDTO).not.toHaveProperty('tagIds');
  });
});

describe('etiquetarTarefa', () => {
  it('remover: GET removeTagFromTask (capturado em 21/10/2026)', async () => {
    mGet.mockResolvedValue({});
    const r = await etiquetarTarefa({ tarefaId: '5861852109373440', etiquetasIds: ['6168384449937408'], acao: 'remover' });
    expect(mGet).toHaveBeenCalledWith(
      expect.anything(),
      `/workspace/v1/removeTagFromTask?taskId=5861852109373440&tagId=6168384449937408&userId=${USER}`,
    );
    expect(r).toEqual({ ok: true, data: { tarefaId: '5861852109373440', acao: 'remover', etiquetasIds: ['6168384449937408'] } });
  });

  it('aplicar: GET addTagToTask', async () => {
    mGet.mockResolvedValue({});
    await etiquetarTarefa({ tarefaId: '1', etiquetasIds: ['2', '3'], acao: 'aplicar' });
    expect(mGet).toHaveBeenCalledTimes(2);
    expect(mGet.mock.calls[1][1]).toBe(`/workspace/v1/addTagToTask?taskId=1&tagId=3&userId=${USER}`);
  });
});
