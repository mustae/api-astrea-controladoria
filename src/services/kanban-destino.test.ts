import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({ astreaApiGet: vi.fn() }));

import {
  camposKanban,
  limparCacheQuadrosKanban,
  lerRegra,
  resolverDestinoKanban,
  validarPedidoKanban,
  type RegrasKanban,
} from './kanban-destino.js';
import { astreaApiGet } from '../browser/astrea-http.js';

const mGet = vi.mocked(astreaApiGet);
const page = {} as never;

const QUADROS = [
  {
    id: 5509986774974464,
    name: 'AUDIENCIAS & PERICIAS',
    default: false,
    columns: [
      { id: 6434416845946880, name: 'A REALIZAR', type: 'BACKLOG' },
      { id: 6152941869236224, name: 'REALIZADAS', type: 'DONE' },
    ],
  },
  {
    id: 6424975299870720,
    name: 'Mateus Iniciais',
    default: false,
    columns: [
      { id: 5495040825655296, name: 'Triagem', type: 'IN_PROGRESS' },
      { id: 6057990779076608, name: 'Aguardando Redação', type: 'BACKLOG' },
    ],
  },
  {
    id: 6480689026334720,
    name: 'Kanban Padrão',
    default: true,
    columns: [
      { id: 5124495716155392, name: 'A Fazer', type: 'BACKLOG' },
      { id: 6071976641724416, name: 'Fazendo', type: 'IN_PROGRESS' },
    ],
  },
];
const PADRAO = { quadroId: '6480689026334720', quadroNome: 'Kanban Padrão', colunaId: '5124495716155392', colunaNome: 'A Fazer' };
const AUDIENCIAS = { quadroId: '5509986774974464', quadroNome: 'AUDIENCIAS & PERICIAS', colunaId: '6434416845946880', colunaNome: 'A REALIZAR' };
const REGRAS: RegrasKanban = { tarefa: 'padrao', prazo: 'padrao', audiencia: 'AUDIENCIAS & PERICIAS', compromisso: 'nenhum' };

beforeEach(() => {
  mGet.mockReset();
  mGet.mockResolvedValue(QUADROS);
  limparCacheQuadrosKanban();
});

describe('lerRegra', () => {
  it.each([
    [undefined, 'padrao'],
    ['', 'padrao'],
    [' padrão ', 'padrao'],
    ['NENHUM', 'nenhum'],
    ['AUDIENCIAS & PERICIAS', { quadro: 'AUDIENCIAS & PERICIAS' }],
    ['Mateus Iniciais > Aguardando Revisão', { quadro: 'Mateus Iniciais', coluna: 'Aguardando Revisão' }],
  ])('%j → %j', (valor, esperado) => {
    expect(lerRegra(valor, 'padrao')).toEqual(esperado);
  });

  it('valor ausente usa o fallback do tipo', () => {
    expect(lerRegra(undefined, 'nenhum')).toBe('nenhum');
  });
});

describe('validarPedidoKanban', () => {
  it('aceita undefined, false e { quadro, coluna? }', () => {
    expect(() => validarPedidoKanban(undefined)).not.toThrow();
    expect(() => validarPedidoKanban(false)).not.toThrow();
    expect(() => validarPedidoKanban({ quadro: 'Kanban Padrão' })).not.toThrow();
  });

  it('quadro vazio → VALIDATION_ERROR', () => {
    expect(() => validarPedidoKanban({ quadro: '  ' })).toThrow(/^VALIDATION_ERROR/);
  });
});

describe('resolverDestinoKanban', () => {
  it('sem pedido aplica a regra do tipo: padrao → quadro default, 1ª coluna', async () => {
    expect(await resolverDestinoKanban(page, 'tarefa', undefined, REGRAS)).toEqual(PADRAO);
    expect(mGet).toHaveBeenCalledWith(page, '/kanbans');
  });

  it('regra por nome (sem acento/caixa) → aquele quadro', async () => {
    expect(await resolverDestinoKanban(page, 'audiencia', undefined, { ...REGRAS, audiencia: 'audiencias & pericias' })).toEqual(AUDIENCIAS);
  });

  it('sem coluna → sempre a 1ª coluna do quadro, mesmo que não seja "a fazer"', async () => {
    const r = await resolverDestinoKanban(page, 'prazo', { quadro: 'Mateus Iniciais' }, REGRAS);
    expect(r).toMatchObject({ colunaId: '5495040825655296', colunaNome: 'Triagem' });
  });

  it('audiência sem regra no .env → AUDIENCIAS & PERICIAS; tarefa/prazo sem regra → quadro padrão', async () => {
    const SEM: RegrasKanban = { tarefa: undefined, prazo: undefined, audiencia: undefined, compromisso: undefined };
    expect(await resolverDestinoKanban(page, 'audiencia', undefined, SEM)).toEqual(AUDIENCIAS);
    expect(await resolverDestinoKanban(page, 'prazo', undefined, SEM)).toEqual(PADRAO);
    expect(await resolverDestinoKanban(page, 'tarefa', undefined, SEM)).toEqual(PADRAO);
    expect(await resolverDestinoKanban(page, 'compromisso', undefined, SEM)).toBeNull();
  });

  it('regra nenhum → null sem consultar o Astrea', async () => {
    expect(await resolverDestinoKanban(page, 'compromisso', undefined, REGRAS)).toBeNull();
    expect(mGet).not.toHaveBeenCalled();
  });

  it('pedido false → null mesmo com regra', async () => {
    expect(await resolverDestinoKanban(page, 'tarefa', false, REGRAS)).toBeNull();
    expect(mGet).not.toHaveBeenCalled();
  });

  it('pedido explícito vence a regra: por nome, com coluna por nome', async () => {
    const r = await resolverDestinoKanban(page, 'prazo', { quadro: 'kanban padrao', coluna: 'fazendo' }, REGRAS);
    expect(r).toEqual({ ...PADRAO, colunaId: '6071976641724416', colunaNome: 'Fazendo' });
  });

  it('pedido explícito por id de quadro e de coluna', async () => {
    const r = await resolverDestinoKanban(page, 'compromisso', { quadro: '5509986774974464', coluna: '6152941869236224' }, REGRAS);
    expect(r).toEqual({ ...AUDIENCIAS, colunaId: '6152941869236224', colunaNome: 'REALIZADAS' });
  });

  it('pedido com quadro inexistente → VALIDATION_ERROR listando os quadros', async () => {
    await expect(resolverDestinoKanban(page, 'tarefa', { quadro: 'Não existe' }, REGRAS)).rejects.toThrow(
      /^VALIDATION_ERROR: .*Não existe.*AUDIENCIAS & PERICIAS.*Mateus Iniciais.*Kanban Padrão/,
    );
  });

  it('pedido com coluna inexistente → VALIDATION_ERROR listando as colunas', async () => {
    await expect(resolverDestinoKanban(page, 'tarefa', { quadro: 'Kanban Padrão', coluna: 'X' }, REGRAS)).rejects.toThrow(
      /^VALIDATION_ERROR: .*A Fazer.*Fazendo/,
    );
  });

  it('regra apontando para quadro inexistente → null (não derruba a criação)', async () => {
    expect(await resolverDestinoKanban(page, 'audiencia', undefined, { ...REGRAS, audiencia: 'Sumiu' })).toBeNull();
  });

  it('regra da natureza (cliente) vence a do tipo; pedido da chamada vence as duas', async () => {
    const MATEUS = { quadroId: '6424975299870720', quadroNome: 'Mateus Iniciais', colunaId: '5495040825655296', colunaNome: 'Triagem' };
    expect(await resolverDestinoKanban(page, 'prazo', undefined, REGRAS, 'Mateus Iniciais')).toEqual(MATEUS);
    expect(await resolverDestinoKanban(page, 'prazo', { quadro: 'Kanban Padrão' }, REGRAS, 'Mateus Iniciais')).toEqual(PADRAO);
    expect(await resolverDestinoKanban(page, 'prazo', false, REGRAS, 'Mateus Iniciais')).toBeNull();
  });

  it('regra da natureza com quadro inexistente → null + aviso (não derruba a criação)', async () => {
    expect(await resolverDestinoKanban(page, 'prazo', undefined, REGRAS, 'Sumiu')).toBeNull();
  });

  it('lista de quadros fica em cache entre criações', async () => {
    await resolverDestinoKanban(page, 'tarefa', undefined, REGRAS);
    await resolverDestinoKanban(page, 'prazo', undefined, REGRAS);
    expect(mGet).toHaveBeenCalledTimes(1);
  });
});

describe('camposKanban', () => {
  it('null → {} (fora do Kanban)', () => {
    expect(camposKanban(null)).toEqual({});
  });

  it('destino → kanbanId/kanbanColumnId e kanbanDetails, como strings (formulário do Astrea)', () => {
    expect(camposKanban(PADRAO)).toEqual({
      kanbanId: PADRAO.quadroId,
      kanbanColumnId: PADRAO.colunaId,
      kanbanDetails: { id: PADRAO.quadroId, columnId: PADRAO.colunaId },
    });
  });
});
