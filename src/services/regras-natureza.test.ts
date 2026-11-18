import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/astrea-http.js', () => ({
  astreaApiGet: vi.fn(),
  getAstreaUserId: vi.fn().mockResolvedValue('6537740792659968'),
}));
vi.mock('./usuarios.service.js', () => ({ listarUsuarios: vi.fn() }));

import {
  lerMapa,
  naturezaDoProcesso,
  quadroDaNatureza,
  responsavelDaNatureza,
  type Natureza,
} from './regras-natureza.js';
import { limparCacheEtiquetaAutomatica } from './etiqueta-automatica.js';
import { astreaApiGet } from '../browser/astrea-http.js';
import { listarUsuarios } from './usuarios.service.js';

const mGet = vi.mocked(astreaApiGet);
const mUsuarios = vi.mocked(listarUsuarios);
const page = {} as never;
const CASO = '4959517162110976';
const TAGS = {
  items: [
    { id: 1, label: 'Trabalhista', active: true },
    { id: 2, label: 'Previdenciário', active: true },
    { id: 3, label: 'Família', active: true },
    { id: 4, label: 'Cível', active: true },
    { id: 5, label: 'Urgente', active: true },
  ],
};
const USUARIOS = [
  { id: '11', nome: 'Charles Silva', email: '' },
  { id: '22', nome: 'Mariane Souza', email: '' },
  { id: '33', nome: 'Diego Ramos', email: 'diego@escritorio.adv.br' },
  { id: '44', nome: 'Diego Costa', email: 'diego@hotmail.com' },
];
const REGRAS = 'Trabalhista=Charles; Previdenciário=Mariane; Cível,Família,Tributário,Criminal=Diego Ramos';

function nat(etiquetasItem: string[] = [], etiquetasProcesso: string[] = [], clientes: string[] = []): Natureza {
  return { etiquetasItem, etiquetasProcesso, clientes };
}

beforeEach(() => {
  mGet.mockReset();
  mGet.mockImplementation(async (_p: unknown, path: string) => {
    if (path === '/tags/get-all-tags') return TAGS as never;
    if (path.startsWith(`/folder/${CASO}`)) {
      return { id: Number(CASO), tagIds: [4, 5], customers: [{ id: 9, name: 'SINDISMED - Sindicato dos Médicos' }] } as never;
    }
    throw new Error('API_ERROR_404');
  });
  mUsuarios.mockReset();
  mUsuarios.mockResolvedValue({ ok: true, data: USUARIOS });
  limparCacheEtiquetaAutomatica();
});

describe('lerMapa', () => {
  it('"a,b=X; c=Y" → chaves normalizadas; vazio/"nenhuma" → []', () => {
    expect(lerMapa('Cível, Família = Diego ; Trabalhista=Charles')).toEqual([
      { chaves: ['civel', 'familia'], alvo: 'Diego' },
      { chaves: ['trabalhista'], alvo: 'Charles' },
    ]);
    expect(lerMapa('')).toEqual([]);
    expect(lerMapa('nenhuma')).toEqual([]);
    expect(lerMapa('sem-igual; =X; a=')).toEqual([]);
  });
});

describe('naturezaDoProcesso', () => {
  it('lê etiquetas (item e processo) e clientes do processo', async () => {
    const n = await naturezaDoProcesso(page, CASO, ['1']);
    expect(n).toEqual({
      etiquetasItem: ['Trabalhista'],
      etiquetasProcesso: ['Cível', 'Urgente'],
      clientes: ['SINDISMED - Sindicato dos Médicos'],
    });
    expect(mGet).toHaveBeenCalledWith(page, `/folder/${CASO}?userId=6537740792659968&withDetails=true`);
  });

  it('falha ao ler o processo não impede a criação: só etiquetas do item', async () => {
    const n = await naturezaDoProcesso(page, '999', ['2']);
    expect(n).toEqual({ etiquetasItem: ['Previdenciário'], etiquetasProcesso: [], clientes: [] });
  });

  it('sem processo → só etiquetas do item, sem GET /folder', async () => {
    const n = await naturezaDoProcesso(page, undefined, ['3']);
    expect(n).toEqual({ etiquetasItem: ['Família'], etiquetasProcesso: [], clientes: [] });
    expect(mGet.mock.calls.some(([, p]) => String(p).startsWith('/folder'))).toBe(false);
  });
});

describe('responsavelDaNatureza', () => {
  it('etiqueta de área do processo → advogado da área (sem acento/caixa)', async () => {
    expect(await responsavelDaNatureza(nat([], ['civel']), REGRAS)).toBe('33');
    expect(await responsavelDaNatureza(nat([], ['TRABALHISTA']), REGRAS)).toBe('11');
    expect(await responsavelDaNatureza(nat([], ['Previdenciario', 'Urgente']), REGRAS)).toBe('22');
  });

  it('etiquetas reais do escritório (prefixo numérico, "demanda diversa") casam por palavra', async () => {
    expect(await responsavelDaNatureza(nat([], ['1 TRABALHISTA']), REGRAS)).toBe('11');
    expect(await responsavelDaNatureza(nat([], ['6 PREVIDENCIARIO - DEMANDA DIVERSA']), REGRAS)).toBe('22');
    expect(await responsavelDaNatureza(nat([], ['3 CIVEL', '5 CRIMINAL']), REGRAS)).toBe('33');
    expect(await responsavelDaNatureza(nat([], ['Trabalhistas']), REGRAS)).toBeNull();
  });

  it('etiqueta do item vence a do processo', async () => {
    expect(await responsavelDaNatureza(nat(['Trabalhista'], ['Cível']), REGRAS)).toBe('11');
  });

  it('áreas de advogados diferentes no mesmo nível → null (ambíguo)', async () => {
    expect(await responsavelDaNatureza(nat([], ['Trabalhista', 'Cível']), REGRAS)).toBeNull();
  });

  it('duas áreas do mesmo advogado não é conflito', async () => {
    expect(await responsavelDaNatureza(nat([], ['Cível', 'Família']), REGRAS)).toBe('33');
  });

  it('sem etiqueta de área → null', async () => {
    expect(await responsavelDaNatureza(nat(['Urgente'], ['Urgente']), REGRAS)).toBeNull();
    expect(mUsuarios).not.toHaveBeenCalled();
  });

  it('usuário inexistente ou nome ambíguo → null; id também serve', async () => {
    expect(await responsavelDaNatureza(nat([], ['Cível']), 'Cível=Fulano')).toBeNull();
    expect(await responsavelDaNatureza(nat([], ['Cível']), 'Cível=Diego')).toBeNull();
    expect(await responsavelDaNatureza(nat([], ['Cível']), 'Cível=22')).toBe('22');
  });

  it('e-mail desambigua homônimos', async () => {
    expect(await responsavelDaNatureza(nat([], ['Cível']), 'Cível=DIEGO@escritorio.adv.br')).toBe('33');
  });
});

describe('quadroDaNatureza', () => {
  it('cliente do processo contém o termo → quadro da regra', () => {
    expect(quadroDaNatureza(nat([], [], ['SINDISMED - Sindicato dos Médicos']), 'Sindismed=Demandas do SINDISMED')).toBe(
      'Demandas do SINDISMED',
    );
  });

  it('nenhum cliente casa → undefined', () => {
    expect(quadroDaNatureza(nat([], [], ['João']), 'Sindismed=Demandas do SINDISMED')).toBeUndefined();
    expect(quadroDaNatureza(nat(), 'Sindismed=Demandas do SINDISMED')).toBeUndefined();
  });

  it('padrão do escritório: SINDISMED → Demandas do SINDISMED', () => {
    expect(quadroDaNatureza(nat([], [], ['Sindismed']))).toBe('Demandas do SINDISMED');
  });
});
