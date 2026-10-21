import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  ANGULAR_PAGE_PATH: '/#/main/contacts',
  withBrowserContext: vi.fn(<T>(op: (page: unknown) => Promise<T>) => op({})),
  astreaApiPost: vi.fn(),
  astreaApiPut: vi.fn(),
  astreaApiDelete: vi.fn(),
  astreaGapiGet: vi.fn(),
  astreaGapiPost: vi.fn(),
  getAstreaUserId: vi.fn().mockResolvedValue('6537740792659968'),
}));

vi.mock('../browser/navigator.js', () => ({
  navigateTo: vi.fn().mockResolvedValue(undefined),
}));

import {
  criarAndamento,
  editarProcesso,
  encerrarProcessos,
  etiquetarProcessos,
  excluirAndamento,
  excluirTarefa,
  montarAndamentoPayload,
  reativarProcesso,
} from './processos-mutacoes.service.js';
import {
  astreaApiDelete,
  astreaApiPost,
  astreaApiPut,
  astreaGapiGet,
  astreaGapiPost,
} from '../browser/astrea-http.js';

const USER = '6537740792659968';
const CASO = '4959517162110976';
const CASO2 = '6209874352701440';
const TAG = '5508862302945280';

const mGet = vi.mocked(astreaGapiGet);
const mGpost = vi.mocked(astreaGapiPost);
const mPost = vi.mocked(astreaApiPost);
const mPut = vi.mocked(astreaApiPut);
const mDel = vi.mocked(astreaApiDelete);

beforeEach(() => {
  for (const m of [mGet, mGpost, mPost, mPut, mDel]) m.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('etiquetarProcessos', () => {
  it('aplicar: GET addTagToCase por processo × etiqueta (contrato capturado em 21/10/2026)', async () => {
    mGet.mockResolvedValue(undefined);
    const r = await etiquetarProcessos({ processoIds: [CASO, CASO2], etiquetasIds: [TAG], acao: 'aplicar' });
    expect(mGet).toHaveBeenCalledTimes(2);
    expect(mGet).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      `/folders/v1/addTagToCase?caseId=${CASO}&tagId=${TAG}&userId=${USER}`,
    );
    expect(r).toEqual({
      ok: true,
      data: {
        acao: 'aplicar',
        total: 2,
        sucesso: 2,
        falhas: 0,
        itens: [
          { processoId: CASO, ok: true },
          { processoId: CASO2, ok: true },
        ],
      },
    });
  });

  it('remover usa removeTagFromCase', async () => {
    mGet.mockResolvedValue(undefined);
    await etiquetarProcessos({ processoIds: [CASO], etiquetasIds: [TAG], acao: 'remover' });
    expect(mGet.mock.calls[0][1]).toContain('/folders/v1/removeTagFromCase?caseId=');
  });

  it('falha de um processo não interrompe os demais', async () => {
    mGet.mockRejectedValueOnce(new Error('API_ERROR_403: sem permissão')).mockResolvedValue(undefined);
    const r = await etiquetarProcessos({ processoIds: [CASO, CASO2], etiquetasIds: [TAG], acao: 'aplicar' });
    expect(r.ok && r.data.falhas).toBe(1);
    expect(r.ok && r.data.itens[0]).toEqual({ processoId: CASO, ok: false, erro: 'API_ERROR_403: sem permissão' });
    expect(r.ok && r.data.itens[1].ok).toBe(true);
  });

  it('remove ids repetidos', async () => {
    mGet.mockResolvedValue(undefined);
    const r = await etiquetarProcessos({ processoIds: [CASO, CASO], etiquetasIds: [TAG], acao: 'aplicar' });
    expect(r.ok && r.data.total).toBe(1);
  });

  it('mais de 10 processos exige confirmar=true', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => String(1000 + i));
    const r = await etiquetarProcessos({ processoIds: ids, etiquetasIds: [TAG], acao: 'aplicar' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mGet).not.toHaveBeenCalled();
  });

  it('limite de 200 processos por chamada', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => String(1000 + i));
    const r = await etiquetarProcessos({ processoIds: ids, etiquetasIds: [TAG], acao: 'aplicar', confirmar: true });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
  });

  it('listas vazias ou ids inválidos → VALIDATION_ERROR', async () => {
    expect((await etiquetarProcessos({ processoIds: [], etiquetasIds: [TAG], acao: 'aplicar' })).ok).toBe(false);
    expect((await etiquetarProcessos({ processoIds: ['x'], etiquetasIds: [TAG], acao: 'aplicar' })).ok).toBe(false);
    expect(mGet).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('editarProcesso', () => {
  const BASE = {
    id: CASO,
    title: 'TESTE DISCOVERY - APAGAR',
    caseType: 'CTE_LAWSUIT',
    caseVersion: 1,
    version: 1,
    customers: [{ id: '5273377616199680', main: true }],
  };

  it('lê getCaseById e regrava via saveLawsuit preservando o resto', async () => {
    mGet.mockResolvedValueOnce(BASE);
    mGpost.mockResolvedValueOnce({ response: { id: CASO }, folder: { id: CASO } });

    const r = await editarProcesso(CASO, { objeto: 'Novo objeto', valorCondenacao: 1000 });

    expect(mGet).toHaveBeenCalledWith(expect.anything(), `/folders/v1/getCaseById?id=${CASO}&userId=${USER}`);
    const [, path, body] = mGpost.mock.calls[0];
    expect(path).toBe(`/folders/v1/saveLawsuit?userId=${USER}&alt=json`);
    expect(body).toMatchObject({
      ...BASE,
      description: 'Novo objeto',
      convictionAmount: 1000,
      userId: USER,
    });
    expect(body).not.toHaveProperty('tags'); // não mexe nas etiquetas
    expect(r).toEqual({ ok: true, data: { id: CASO, alterados: ['objeto', 'valorCondenacao'] } });
  });

  it('não envia campos não informados', async () => {
    mGet.mockResolvedValueOnce({ ...BASE, description: 'antigo' });
    mGpost.mockResolvedValueOnce({ folder: { id: CASO } });
    await editarProcesso(CASO, { valorCondenacao: 5 });
    expect(mGpost.mock.calls[0][2]).toMatchObject({ description: 'antigo', convictionAmount: 5 });
  });

  it('sem nenhum campo → VALIDATION_ERROR', async () => {
    const r = await editarProcesso(CASO, {});
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mGet).not.toHaveBeenCalled();
  });

  it('caso (não-processo) ainda não suportado → VALIDATION_ERROR sem gravar', async () => {
    mGet.mockResolvedValueOnce({ ...BASE, caseType: 'CTE_CASE' });
    const r = await editarProcesso(CASO, { objeto: 'x' });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mGpost).not.toHaveBeenCalled();
  });

  it('404 no getCaseById → NOT_FOUND', async () => {
    mGet.mockRejectedValueOnce(new Error('API_ERROR_404: not found'));
    const r = await editarProcesso(CASO, { objeto: 'x' });
    expect(!r.ok && r.error.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('encerrarProcessos', () => {
  it('exige confirmar=true', async () => {
    const r = await encerrarProcessos({ processoIds: [CASO] });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mPost).not.toHaveBeenCalled();
  });

  it('POST /folder/inactivate por processo com o corpo capturado', async () => {
    mPost.mockResolvedValue({});
    const r = await encerrarProcessos({
      processoIds: [CASO],
      valorCondenacao: 10000,
      desvincularTribunal: true,
      confirmar: true,
    });
    expect(mPost).toHaveBeenCalledWith(expect.anything(), '/folder/inactivate', {
      caseId: Number(CASO),
      unlink: true,
      userId: USER,
      isFromMainCase: true,
      judgments: 'DOESNT_APPLY',
      convictionAmount: 10000,
      judgmentsOutcome: null,
    });
    expect(r.ok && r.data).toMatchObject({ total: 1, sucesso: 1, falhas: 0 });
  });

  it('default: não desvincula do tribunal e valor null', async () => {
    mPost.mockResolvedValue({});
    await encerrarProcessos({ processoIds: [CASO], confirmar: true });
    expect(mPost.mock.calls[0][2]).toMatchObject({ unlink: false, convictionAmount: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('reativarProcesso', () => {
  it('processo encerrado → PUT toggle-activate-inactivate-case', async () => {
    mGet.mockResolvedValueOnce({ id: CASO, status: 'Inactive' });
    mPut.mockResolvedValueOnce(undefined);
    const r = await reativarProcesso(CASO);
    expect(mPut).toHaveBeenCalledWith(expect.anything(), '/case/toggle-activate-inactivate-case', {
      caseId: Number(CASO),
      unlink: false,
      isFromMainCase: true,
      userId: USER,
    });
    expect(r).toEqual({ ok: true, data: { id: CASO, reativado: true } });
  });

  it('já ativo → NÃO chama o toggle (que encerraria o processo)', async () => {
    mGet.mockResolvedValueOnce({ id: CASO, status: 'Active' });
    const r = await reativarProcesso(CASO);
    expect(mPut).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, data: { id: CASO, reativado: false, jaEstavaAtivo: true } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('montarAndamentoPayload', () => {
  it('reproduz o formato capturado (data/hora em São Paulo, HTML escapado)', () => {
    const agora = new Date('2026-10-21T17:34:04.516Z'); // 14:34 em SP
    const p = montarAndamentoPayload(
      { processoId: CASO, descricao: 'Linha <1>\nLinha & 2' },
      USER,
      agora,
    );
    expect(p).toEqual({
      date: '2026-10-21T17:34:04.516Z',
      historicalTime: '14:34',
      description: '<p>Linha &lt;1&gt;</p><p>Linha &amp; 2</p>',
      responsible: USER,
      historicalParentId: null,
      caseId: Number(CASO),
      rootCaseId: null,
      clippingId: null,
      type: 'MANUALLY',
      tagIds: [],
      id: null,
      dateStr: '2026-10-21 14:34:04',
      userId: USER,
    });
  });

  it('data YYYY-MM-DD informada → meio-dia em SP desse dia', () => {
    const p = montarAndamentoPayload({ processoId: CASO, descricao: 'x', data: '2026-03-05' }, USER, new Date());
    expect(p.date).toBe('2026-03-05T15:00:00.000Z');
    expect(p.dateStr).toBe('2026-03-05 12:00:00');
    expect(p.historicalTime).toBe('12:00');
  });

  it('responsavelId informado substitui o usuário logado', () => {
    const p = montarAndamentoPayload({ processoId: CASO, descricao: 'x', responsavelId: '42' }, USER, new Date());
    expect(p.responsible).toBe('42');
  });
});

describe('criarAndamento / excluirAndamento', () => {
  it('POST saveHistoricalByCase e devolve id', async () => {
    mGpost.mockResolvedValueOnce({ id: '5241108312653824', date: '2026-10-21T17:34:04.000Z', type: 'MANUALLY' });
    const r = await criarAndamento({ processoId: CASO, descricao: 'Protocolada petição' });
    expect(mGpost.mock.calls[0][1]).toBe('/histories/v1/saveHistoricalByCase');
    expect(r).toEqual({
      ok: true,
      data: { id: '5241108312653824', processoId: CASO, data: '2026-10-21T17:34:04.000Z', descricao: 'Protocolada petição' },
    });
  });

  it('descrição vazia → VALIDATION_ERROR', async () => {
    const r = await criarAndamento({ processoId: CASO, descricao: '   ' });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
  });

  it('excluir: DELETE /historical/{id}', async () => {
    mDel.mockResolvedValueOnce(undefined);
    const r = await excluirAndamento('5241108312653824');
    expect(mDel).toHaveBeenCalledWith(expect.anything(), '/historical/5241108312653824');
    expect(r).toEqual({ ok: true, data: { id: '5241108312653824', removido: true } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('excluirTarefa', () => {
  it('lê version/dueDate e chama deleteTask (vai para a lixeira)', async () => {
    mGpost
      .mockResolvedValueOnce({ id: '5470724839211008', version: 8, dueDate: '2026-10-22T09:00:00.000Z' })
      .mockResolvedValueOnce({ idTrashCan: '6132585414819840' });

    const r = await excluirTarefa('5470724839211008');

    expect(mGpost).toHaveBeenNthCalledWith(1, expect.anything(), '/workspace/v1/getTaskWithComments', {
      taskId: 5470724839211008,
      userId: USER,
      bringAllComments: false,
    });
    expect(mGpost).toHaveBeenNthCalledWith(2, expect.anything(), '/workspace/v1/deleteTask', {
      taskId: '5470724839211008',
      taskVersion: 8,
      taskListId: null,
      userId: USER,
      date: '2026-10-22T09:00:00.000Z',
    });
    expect(r).toEqual({ ok: true, data: { id: '5470724839211008', removido: true, lixeiraId: '6132585414819840' } });
  });

  it('tarefa sem version → API_ERROR sem chamar deleteTask', async () => {
    mGpost.mockResolvedValueOnce({ id: '1' });
    const r = await excluirTarefa('5470724839211008');
    expect(r.ok).toBe(false);
    expect(mGpost).toHaveBeenCalledTimes(1);
  });
});
