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
  listarUsuarios: vi.fn().mockResolvedValue({ ok: true, data: [{ id: '6537740792659968', nome: 'Doutor' }] }),
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

const USER = '6537740792659968';
const CASO = '4959517162110976';
const TAG = '5508862302945280';
const mGet = vi.mocked(astreaApiGet);
const mPost = vi.mocked(astreaApiPost);

beforeEach(() => {
  mGet.mockReset();
  mPost.mockReset();
});

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
    expect(r).toEqual({ ok: true, data: { id: '6069010864308224', processoId: CASO, titulo: 'Contestação', data: '2026-10-22' } });
  });

  it('valida data e processo antes de abrir o browser', async () => {
    expect((await criarPrazo({ processoId: CASO, titulo: 'x', data: '22/10/2026' })).ok).toBe(false);
    expect((await criarPrazo({ processoId: 'abc', titulo: 'x', data: '2026-10-22' })).ok).toBe(false);
    expect((await criarPrazo({ processoId: CASO, titulo: ' ', data: '2026-10-22' })).ok).toBe(false);
    expect(mPost).not.toHaveBeenCalled();
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
