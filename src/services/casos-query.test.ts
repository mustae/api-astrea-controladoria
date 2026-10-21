import { describe, expect, it } from 'vitest';
import { buildCaseQueryDTO, normalizarIdsNumericos } from './casos-query.js';

const USER = 6528036269752320;

describe('buildCaseQueryDTO', () => {
  it('default: ativos, todos os tipos, sem filtros de etiqueta/cliente/responsável', () => {
    const dto = buildCaseQueryDTO(undefined, USER);
    expect(dto).toMatchObject({
      userId: USER,
      status: 'Active',
      types: [],
      tagIds: [],
      contacts: [],
      users: [],
      order: '-lastMovement',
      isFromContactScreen: false,
    });
  });

  it('mapeia tipo, status e responsável', () => {
    const dto = buildCaseQueryDTO({ tipo: 'processo', status: 'arquivado', responsavelId: '123' }, USER);
    expect(dto.types).toEqual(['CTE_LAWSUIT']);
    expect(dto.status).toBe('Inactive');
    expect(dto.users).toEqual([123]);
  });

  it('status "todos" vira null (sem filtro)', () => {
    expect(buildCaseQueryDTO({ status: 'todos' }, USER).status).toBeNull();
  });

  it('etiquetasIds vai para queryDTO.tagIds como números', () => {
    const dto = buildCaseQueryDTO({ etiquetasIds: ['5629499534213120', '42'] }, USER);
    expect(dto.tagIds).toEqual([5629499534213120, 42]);
  });

  it('clienteIds vai para queryDTO.contacts como números', () => {
    const dto = buildCaseQueryDTO({ clienteIds: ['777'] }, USER);
    expect(dto.contacts).toEqual([777]);
  });
});

describe('normalizarIdsNumericos', () => {
  it('descarta vazios e repetidos, mantém ordem', () => {
    expect(normalizarIdsNumericos(['1', ' 2 ', '', '1'])).toEqual([1, 2]);
  });

  it('lança VALIDATION_ERROR para id não numérico', () => {
    expect(() => normalizarIdsNumericos(['abc'])).toThrow(/VALIDATION_ERROR/);
  });

  it('undefined → []', () => {
    expect(normalizarIdsNumericos(undefined)).toEqual([]);
  });
});
