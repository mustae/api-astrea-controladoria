import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  ANGULAR_PAGE_PATH: '/#/main/contacts',
  withBrowserContext: vi.fn(<T>(op: (page: unknown) => Promise<T>) => op({})),
  astreaApiGet: vi.fn(),
  astreaApiPost: vi.fn(),
  getAstreaUserId: vi.fn().mockResolvedValue('6537740792659968'),
}));
vi.mock('../browser/navigator.js', () => ({ navigateTo: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./usuarios.service.js', () => ({
  listarUsuarios: vi.fn().mockResolvedValue({
    ok: true,
    data: [
      { id: '6537740792659968', nome: 'Doutor' },
      { id: '11', nome: 'Charles Silva', email: 'charles@srsadvogados.adv.br' },
    ],
  }),
}));

import {
  alterarStatusPrazo,
  buscarAudiencia,
  buscarPrazo,
  criarAudiencia,
  criarPrazo,
  editarAudiencia,
  editarPrazo,
  excluirAudiencia,
  excluirPrazo,
} from './prazos-audiencias.service.js';
import { astreaApiGet, astreaApiPost } from '../browser/astrea-http.js';
import { limparCacheQuadrosKanban } from './kanban-destino.js';
import { limparCacheEtiquetaAutomatica } from './etiqueta-automatica.js';

const USER = '6537740792659968';
const CASO = '4959517162110976';
const TAG = '5508862302945280';
const QUADROS = [
  { id: 6480689026334720, name: 'Kanban Padrão', default: true, columns: [{ id: 5124495716155392, name: 'A Fazer', type: 'BACKLOG' }] },
  { id: 5509986774974464, name: 'AUDIENCIAS & PERICIAS', default: false, columns: [{ id: 6434416845946880, name: 'A REALIZAR', type: 'BACKLOG' }] },
  { id: 5924009773662208, name: 'Demandas do SINDISMED', default: false, columns: [{ id: 77, name: 'Recebidas', type: 'BACKLOG' }] },
];
const SINDISMED = { quadroId: '5924009773662208', quadroNome: 'Demandas do SINDISMED', colunaId: '77', colunaNome: 'Recebidas' };
const PADRAO = { quadroId: '6480689026334720', quadroNome: 'Kanban Padrão', colunaId: '5124495716155392', colunaNome: 'A Fazer' };
const AUDIENCIAS = { quadroId: '5509986774974464', quadroNome: 'AUDIENCIAS & PERICIAS', colunaId: '6434416845946880', colunaNome: 'A REALIZAR' };
const TAG_AUDIENCIA = '6025454386708480';
const TAG_TRABALHISTA = '900';
const TAGS = {
  items: [
    { id: 6025454386708480, label: 'Audiência', active: true, restrictions: ['HEARING'] },
    { id: 900, label: 'Trabalhista', active: true },
  ],
};
/** Processo trabalhista do cliente SINDISMED (GET /folder com withDetails). */
const FOLDER_SINDISMED = {
  [`/folder/${CASO}?userId=${'6537740792659968'}&withDetails=true`]: {
    id: Number(CASO),
    tagIds: [900],
    customers: [{ id: 1, name: 'SINDISMED' }],
  },
};
const mGet = vi.mocked(astreaApiGet);
const mPost = vi.mocked(astreaApiPost);

beforeEach(() => {
  mGet.mockReset();
  mPost.mockReset();
  limparCacheQuadrosKanban();
  limparCacheEtiquetaAutomatica();
});

/** GET /kanbans → QUADROS, /tags/get-all-tags → TAGS, `outros[path]` para o resto. */
function comQuadros(outros: Record<string, unknown> = {}) {
  mGet.mockImplementation(async (_p: unknown, path: string) =>
    (path === '/kanbans' ? QUADROS : path === '/tags/get-all-tags' ? TAGS : outros[path]) as never,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe('criarPrazo', () => {
  it('POST /deadlines/save com o corpo capturado (21/10/2026)', async () => {
    mPost.mockResolvedValueOnce({ response: 6069010864308224 });
    const r = await criarPrazo({ processoId: CASO, titulo: ' Contestação ', data: '2026-10-22', etiquetasIds: [TAG] });

    const [, path, body] = mPost.mock.calls[0];
    expect(path).toBe('/deadlines/save');
    expect(body).toMatchObject({
      name: 'Contestação',
      dueDate: '2026-10-22',
      responsibleId: USER,
      responsibleName: 'Doutor',
      status: 'IN_PROGRESS',
      allDay: true,
      caseId: Number(CASO),
      rootCaseId: null,
      deadlineDays: 'workingDays',
      tagIds: [TAG],
      comments: '',
      userId: USER,
      ownerId: USER,
      notify: false,
      alertTimeUnit: 'TUE_DAYS',
    });
    expect(r).toEqual({ ok: true, data: { id: '6069010864308224', processoId: CASO, titulo: 'Contestação', data: '2026-10-22', responsavelId: USER, kanban: null } });
  });

  it('sem pedido → quadro padrão (KANBAN_PRAZO=padrao); resultado traz o destino', async () => {
    comQuadros();
    mPost.mockResolvedValueOnce({ response: 1 });
    const r = await criarPrazo({ processoId: CASO, titulo: 'P', data: '2026-10-22' });
    expect(mPost.mock.calls[0][2]).toMatchObject({
      kanbanId: PADRAO.quadroId,
      kanbanColumnId: PADRAO.colunaId,
      kanbanDetails: { id: PADRAO.quadroId, columnId: PADRAO.colunaId },
    });
    expect(r.ok && r.data.kanban).toEqual(PADRAO);
  });

  it('kanban: false → sem campos de kanban; quadro inexistente → VALIDATION_ERROR sem salvar', async () => {
    comQuadros();
    mPost.mockResolvedValueOnce({ response: 1 });
    const r = await criarPrazo({ processoId: CASO, titulo: 'P', data: '2026-10-22', kanban: false });
    expect(mPost.mock.calls[0][2]).not.toHaveProperty('kanbanId');
    expect(r.ok && r.data.kanban).toBeNull();
    const r2 = await criarPrazo({ processoId: CASO, titulo: 'P', data: '2026-10-22', kanban: { quadro: 'Sumiu' } });
    expect(!r2.ok && r2.error.code).toBe('VALIDATION_ERROR');
    expect(mPost).toHaveBeenCalledTimes(1);
  });

  it('valida data e processo antes de abrir o browser', async () => {
    expect((await criarPrazo({ processoId: CASO, titulo: 'x', data: '22/10/2026' })).ok).toBe(false);
    expect((await criarPrazo({ processoId: 'abc', titulo: 'x', data: '2026-10-22' })).ok).toBe(false);
    expect((await criarPrazo({ processoId: CASO, titulo: ' ', data: '2026-10-22' })).ok).toBe(false);
    expect(mPost).not.toHaveBeenCalled();
  });
});

describe('criarPrazo — regras pela natureza', () => {
  it('processo trabalhista do SINDISMED → responsável Charles e quadro Demandas do SINDISMED', async () => {
    comQuadros(FOLDER_SINDISMED);
    mPost.mockResolvedValueOnce({ response: 1 });
    const r = await criarPrazo({ processoId: CASO, titulo: 'Manifestação', data: '2026-10-30' });
    expect(mPost.mock.calls[0][2]).toMatchObject({
      responsibleId: '11',
      responsibleName: 'Charles Silva',
      kanbanId: SINDISMED.quadroId,
      kanbanColumnId: SINDISMED.colunaId,
    });
    expect(r.ok && r.data).toMatchObject({ responsavelId: '11', kanban: SINDISMED });
  });

  it('responsavelId e kanban informados vencem as regras', async () => {
    comQuadros(FOLDER_SINDISMED);
    mPost.mockResolvedValueOnce({ response: 1 });
    await criarPrazo({ processoId: CASO, titulo: 'X', data: '2026-10-30', responsavelId: USER, kanban: { quadro: 'Kanban Padrão' } });
    expect(mPost.mock.calls[0][2]).toMatchObject({ responsibleId: USER, kanbanId: PADRAO.quadroId });
  });

  it('etiqueta de área no próprio prazo também define o responsável', async () => {
    comQuadros();
    mPost.mockResolvedValueOnce({ response: 1 });
    await criarPrazo({ processoId: CASO, titulo: 'X', data: '2026-10-30', etiquetasIds: [TAG_TRABALHISTA] });
    expect(mPost.mock.calls[0][2]).toMatchObject({ responsibleId: '11', kanbanId: PADRAO.quadroId });
  });
});

describe('editarPrazo', () => {
  const ATUAL = {
    deadlineId: 6069010864308224,
    caseId: 4959517162110976,
    name: 'a',
    dueDate: '2026-10-22',
    responsibleId: 6537740792659968,
    tagIds: [5508862302945280],
    tagDtos: [{ id: 5508862302945280, label: 'X' }],
    status: 'IN_PROGRESS',
    kanbanDetails: { id: 6480689026334720, columnId: 5124495716155392 },
  };

  it('lê GET /deadlines/{id} e regrava só o que mudou', async () => {
    mGet.mockResolvedValueOnce(ATUAL);
    mPost.mockResolvedValueOnce({ response: 6069010864308224 });
    const r = await editarPrazo('6069010864308224', { data: '2026-10-23' });
    expect(mGet).toHaveBeenCalledWith(expect.anything(), '/deadlines/6069010864308224');
    const body = mPost.mock.calls[0][2] as Record<string, unknown>;
    expect(body).toMatchObject({
      ...ATUAL,
      dueDate: '2026-10-23',
      userId: USER,
      deadlineDays: 'workingDays',
      notify: false,
      kanbanId: '6480689026334720',
      kanbanColumnId: '5124495716155392',
      kanbanDetails: { id: '6480689026334720', columnId: '5124495716155392' },
    });
    expect(r).toEqual({ ok: true, data: { id: '6069010864308224', alterados: ['data'] } });
  });

  it('trocar etiquetas substitui tagIds e descarta tagDtos antigos', async () => {
    mGet.mockResolvedValueOnce(ATUAL);
    mPost.mockResolvedValueOnce({ response: 1 });
    await editarPrazo('6069010864308224', { etiquetasIds: [] });
    const body = mPost.mock.calls[0][2] as Record<string, unknown>;
    expect(body.tagIds).toEqual([]);
    expect(body).not.toHaveProperty('tagDtos');
  });

  it('sem campos → VALIDATION_ERROR', async () => {
    const r = await editarPrazo('6069010864308224', {});
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
  });

  it('kanban { quadro } move para outro quadro (1ª coluna) e devolve o destino', async () => {
    comQuadros({ '/deadlines/6069010864308224': ATUAL });
    mPost.mockResolvedValueOnce({ response: 6069010864308224 });
    const r = await editarPrazo('6069010864308224', { kanban: { quadro: 'audiencias & pericias' } });
    expect(mPost.mock.calls[0][2]).toMatchObject({
      kanbanId: AUDIENCIAS.quadroId,
      kanbanColumnId: AUDIENCIAS.colunaId,
      kanbanDetails: { id: AUDIENCIAS.quadroId, columnId: AUDIENCIAS.colunaId },
    });
    expect(r).toEqual({ ok: true, data: { id: '6069010864308224', alterados: ['kanban'], kanban: AUDIENCIAS } });
  });

  it('kanban: false tira do Kanban (kanbanDetails null, sem kanbanId — "0" o Astrea recusa)', async () => {
    comQuadros({ '/deadlines/6069010864308224': ATUAL });
    mPost.mockResolvedValueOnce({ response: 1 });
    const r = await editarPrazo('6069010864308224', { kanban: false });
    const body = mPost.mock.calls[0][2] as Record<string, unknown>;
    expect(body.kanbanDetails).toBeNull();
    expect(body).not.toHaveProperty('kanbanId');
    expect(body).not.toHaveProperty('kanbanColumnId');
    expect(r.ok && r.data.kanban).toBeNull();
  });

  it('kanban com quadro inexistente → VALIDATION_ERROR sem salvar', async () => {
    comQuadros({ '/deadlines/6069010864308224': ATUAL });
    const r = await editarPrazo('6069010864308224', { kanban: { quadro: 'Sumiu' } });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
    expect(mPost).not.toHaveBeenCalled();
  });
});

describe('alterarStatusPrazo / excluirPrazo / buscarPrazo', () => {
  it('concluir: POST update-status DONE com motivo', async () => {
    mPost.mockResolvedValueOnce(undefined);
    const r = await alterarStatusPrazo('6069010864308224', { concluido: true, motivo: 'Cumprido' });
    expect(mPost).toHaveBeenCalledWith(expect.anything(), '/deadlines/update-status', {
      deadlineId: 6069010864308224,
      reason: 'Cumprido',
      userId: USER,
      status: 'DONE',
    });
    expect(r).toEqual({ ok: true, data: { id: '6069010864308224', status: 'concluido' } });
  });

  it('reabrir: IN_PROGRESS sem reason', async () => {
    mPost.mockResolvedValueOnce(undefined);
    await alterarStatusPrazo('6069010864308224', { concluido: false });
    expect(mPost.mock.calls[0][2]).toEqual({ deadlineId: 6069010864308224, userId: USER, status: 'IN_PROGRESS' });
  });

  it('excluir: POST /deadlines/{id}/delete {}', async () => {
    mPost.mockResolvedValueOnce({});
    const r = await excluirPrazo('6069010864308224');
    expect(mPost).toHaveBeenCalledWith(expect.anything(), '/deadlines/6069010864308224/delete', {});
    expect(r.ok).toBe(true);
  });

  it('buscar mapeia o DTO', async () => {
    mGet.mockResolvedValueOnce({
      deadlineId: 6069010864308224,
      name: 'a',
      dueDate: '2026-10-22',
      status: 'DONE',
      caseId: 4959517162110976,
      caseTitle: 'TESTE',
      responsibleId: 1,
      responsibleName: 'Doutor',
      tagDtos: [{ id: 5, label: 'URG' }],
      comments: 'obs',
    });
    const r = await buscarPrazo('6069010864308224');
    expect(r).toEqual({
      ok: true,
      data: {
        id: '6069010864308224',
        titulo: 'a',
        data: '2026-10-22',
        status: 'concluido',
        processoId: '4959517162110976',
        processoTitulo: 'TESTE',
        responsavelId: '1',
        responsavelNome: 'Doutor',
        etiquetas: [{ id: '5', nome: 'URG' }],
        observacoes: 'obs',
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('criarAudiencia', () => {
  const INPUT = {
    processoId: CASO,
    titulo: 'Audiência de conciliação',
    data: '2026-10-22',
    horaInicio: '13:00',
    forum: 'Toledo',
    sala: 'Sala 2',
    endereco: 'Rua X, 1',
    etiquetasIds: [TAG],
  };

  it('checa conflito e faz POST /hearings/save com o corpo capturado', async () => {
    mPost.mockResolvedValueOnce([]).mockResolvedValueOnce({ response: 5421234098831360 });
    const r = await criarAudiencia(INPUT);

    expect(mPost).toHaveBeenNthCalledWith(1, expect.anything(), '/calendar-pro/calendar-conflicts', {
      activityId: null,
      start: '2026-10-22 13:00',
      end: '2026-10-22 13:30',
      userId: USER,
      responsibleId: USER,
    });
    const [, path, body] = mPost.mock.calls[1];
    expect(path).toBe('/hearings/save');
    expect(body).toMatchObject({
      caseId: Number(CASO),
      name: 'Audiência de conciliação',
      hearingDateStart: '2026-10-22',
      hearingDateEnd: '2026-10-22',
      hearingTimeStart: '13:00',
      hearingTimeEnd: '13:30',
      courthouse: 'Toledo',
      courthouseRoom: 'Sala 2',
      address: 'Rua X, 1',
      addressType: 'PHYSICAL_ADDRESS',
      responsibleId: USER,
      ownerId: USER,
      userId: USER,
      status: 'IN_PROGRESS',
      tagIds: [TAG],
      contactTypeEnum: 'INTERNAL_USER',
      notify: false,
      involved: [],
      reminders: [],
    });
    expect(r.ok && r.data).toMatchObject({ id: '5421234098831360', data: '2026-10-22', horaInicio: '13:00', horaFim: '13:30' });
  });

  it('sem pedido → AUDIENCIAS & PERICIAS e acrescenta a etiqueta "Audiência"', async () => {
    comQuadros();
    mPost.mockResolvedValueOnce({ response: 1 });
    const r = await criarAudiencia({ ...INPUT, verificarConflito: false });
    expect(mPost.mock.calls[0][2]).toMatchObject({
      kanbanId: AUDIENCIAS.quadroId,
      kanbanColumnId: AUDIENCIAS.colunaId,
      tagIds: [TAG, TAG_AUDIENCIA],
    });
    expect(r.ok && r.data.kanban).toEqual(AUDIENCIAS);
  });

  it('regras: responsável pela área; quadro continua AUDIENCIAS & PERICIAS mesmo com cliente SINDISMED', async () => {
    comQuadros(FOLDER_SINDISMED);
    mPost.mockResolvedValueOnce({ response: 1 });
    const r = await criarAudiencia({ ...INPUT, verificarConflito: false });
    expect(mPost.mock.calls[0][2]).toMatchObject({ responsibleId: '11', kanbanId: AUDIENCIAS.quadroId });
    expect(r.ok && r.data).toMatchObject({ responsavelId: '11', kanban: AUDIENCIAS });
  });

  it('etiqueta "Audiência" já informada não duplica', async () => {
    comQuadros();
    mPost.mockResolvedValueOnce({ response: 1 });
    await criarAudiencia({ ...INPUT, etiquetasIds: [TAG_AUDIENCIA], verificarConflito: false });
    expect(mPost.mock.calls[0][2]).toMatchObject({ tagIds: [TAG_AUDIENCIA] });
  });

  it('pedido por nome → aquele quadro no /hearings/save', async () => {
    comQuadros();
    mPost.mockResolvedValueOnce([]).mockResolvedValueOnce({ response: 1 });
    const r = await criarAudiencia({ ...INPUT, kanban: { quadro: 'AUDIENCIAS & PERICIAS' } });
    expect(mPost.mock.calls[1][2]).toMatchObject({ kanbanId: '5509986774974464', kanbanColumnId: '6434416845946880' });
    expect(r.ok && r.data.kanban?.quadroNome).toBe('AUDIENCIAS & PERICIAS');
  });

  it('conflito → CONFLICT sem salvar', async () => {
    mPost.mockResolvedValueOnce([{ id: 1, title: 'outra' }]);
    const r = await criarAudiencia(INPUT);
    expect(!r.ok && r.error.code).toBe('CONFLICT');
    expect(mPost).toHaveBeenCalledTimes(1);
  });

  it('verificarConflito=false pula a checagem', async () => {
    mPost.mockResolvedValueOnce({ response: 9 });
    await criarAudiencia({ ...INPUT, verificarConflito: false });
    expect(mPost).toHaveBeenCalledTimes(1);
    expect(mPost.mock.calls[0][1]).toBe('/hearings/save');
  });

  it('modalidade remoto → ONLINE_MEETING; horaFim inválida → VALIDATION_ERROR', async () => {
    mPost.mockResolvedValueOnce({ response: 9 });
    await criarAudiencia({ ...INPUT, modalidade: 'remoto', verificarConflito: false });
    expect(mPost.mock.calls[0][2]).toMatchObject({ addressType: 'ONLINE_MEETING' });
    const r = await criarAudiencia({ ...INPUT, horaFim: '12:00' });
    expect(!r.ok && r.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('editarAudiencia / excluirAudiencia / buscarAudiencia', () => {
  const ATUAL = {
    hearingId: 5421234098831360,
    caseId: 4959517162110976,
    name: 'a',
    hearingDateStart: '2026-10-22',
    hearingTimeStart: '13:00',
    hearingDateEnd: '2026-10-22',
    hearingTimeEnd: '13:30',
    courthouse: 'Toledo',
    courthouseRoom: 'Sala',
    address: 'a',
    addressType: 'PHYSICAL_ADDRESS',
    responsibleId: 6537740792659968,
    tagIds: [6025454386708480],
    status: 'IN_PROGRESS',
    kanbanDetails: { id: 1, columnId: 2 },
  };

  it('remarcar: lê, checa conflito com activityId e salva', async () => {
    mGet.mockResolvedValueOnce(ATUAL);
    mPost.mockResolvedValueOnce([]).mockResolvedValueOnce({ response: 5421234098831360 });
    const r = await editarAudiencia('5421234098831360', { horaInicio: '14:00' });
    expect(mGet).toHaveBeenCalledWith(expect.anything(), '/hearings/5421234098831360');
    expect(mPost.mock.calls[0][2]).toMatchObject({ activityId: 5421234098831360, start: '2026-10-22 14:00', end: '2026-10-22 14:30' });
    expect(mPost.mock.calls[1][2]).toMatchObject({
      ...ATUAL,
      hearingTimeStart: '14:00',
      hearingTimeEnd: '14:30',
      userId: USER,
      notify: false,
      shouldNotify: false,
      kanbanId: '1',
      kanbanColumnId: '2',
      kanbanDetails: { id: '1', columnId: '2' },
    });
    expect(r).toEqual({ ok: true, data: { id: '5421234098831360', alterados: ['horaInicio'] } });
  });

  it('trocar etiquetas mantém a etiqueta "Audiência"', async () => {
    comQuadros({ '/hearings/5421234098831360': ATUAL });
    mPost.mockResolvedValueOnce({ response: 1 });
    await editarAudiencia('5421234098831360', { etiquetasIds: [TAG] });
    expect((mPost.mock.calls[0][2] as Record<string, unknown>).tagIds).toEqual([TAG, TAG_AUDIENCIA]);
  });

  it('kanban { quadro, coluna } troca o quadro sem checar conflito', async () => {
    comQuadros({ '/hearings/5421234098831360': ATUAL });
    mPost.mockResolvedValueOnce({ response: 5421234098831360 });
    const r = await editarAudiencia('5421234098831360', { kanban: { quadro: 'Kanban Padrão', coluna: 'A Fazer' } });
    expect(mPost).toHaveBeenCalledTimes(1);
    expect(mPost.mock.calls[0][2]).toMatchObject({ kanbanId: PADRAO.quadroId, kanbanColumnId: PADRAO.colunaId });
    expect(r).toEqual({ ok: true, data: { id: '5421234098831360', alterados: ['kanban'], kanban: PADRAO } });
  });

  it('excluir: POST /hearings/{id}/delete', async () => {
    mPost.mockResolvedValueOnce({});
    const r = await excluirAudiencia('5421234098831360');
    expect(mPost).toHaveBeenCalledWith(expect.anything(), '/hearings/5421234098831360/delete', {});
    expect(r.ok).toBe(true);
  });

  it('buscar mapeia o DTO', async () => {
    mGet.mockResolvedValueOnce({ ...ATUAL, caseTitle: 'T', responsibleName: 'Doutor', tagDtos: [{ id: 6, label: 'Aud' }] });
    const r = await buscarAudiencia('5421234098831360');
    expect(r.ok && r.data).toMatchObject({
      id: '5421234098831360',
      titulo: 'a',
      data: '2026-10-22',
      horaInicio: '13:00',
      horaFim: '13:30',
      forum: 'Toledo',
      sala: 'Sala',
      endereco: 'a',
      modalidade: 'presencial',
      processoId: '4959517162110976',
      etiquetas: [{ id: '6', nome: 'Aud' }],
      status: 'pendente',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('pool: usuários antes da aba, criação sem retry de timeout', () => {
  // listarUsuarios() abre uma 2ª aba quando o cache está frio; chamado DENTRO do
  // withBrowserContext, N criações paralelas seguram as N vagas e esperam uma N+1.
  async function ordem(chamar: () => Promise<unknown>) {
    const { withBrowserContext } = await import('../browser/astrea-http.js');
    const { listarUsuarios } = await import('./usuarios.service.js');
    vi.mocked(withBrowserContext).mockClear();
    vi.mocked(listarUsuarios).mockClear();
    comQuadros({ ...FOLDER_SINDISMED, [`/deadlines/1`]: { id: 1 }, [`/hearings/1`]: { id: 1 } });
    mPost.mockResolvedValue({ id: 1 } as never);
    await chamar();
    return {
      usuarios: vi.mocked(listarUsuarios).mock.invocationCallOrder[0],
      aba: vi.mocked(withBrowserContext).mock.invocationCallOrder[0],
      opcoes: vi.mocked(withBrowserContext).mock.calls[0]?.[1],
    };
  }

  it('criarPrazo carrega usuários antes de ocupar a aba e marca escrita', async () => {
    const o = await ordem(() => criarPrazo({ processoId: CASO, titulo: 'P', data: '2026-10-22' }));
    expect(o.usuarios).toBeLessThan(o.aba);
    expect(o.opcoes).toEqual({ escrita: true });
  });

  it('criarAudiencia carrega usuários antes de ocupar a aba e marca escrita', async () => {
    const o = await ordem(() => criarAudiencia({ processoId: CASO, titulo: 'A', data: '2026-10-22', horaInicio: '10:00' }));
    expect(o.usuarios).toBeLessThan(o.aba);
    expect(o.opcoes).toEqual({ escrita: true });
  });

  it('editarPrazo com responsável carrega usuários antes de ocupar a aba', async () => {
    const o = await ordem(() => editarPrazo('1', { responsavelId: '11' }));
    expect(o.usuarios).toBeLessThan(o.aba);
  });
});
