import { describe, expect, it, vi } from 'vitest';

// Conta abas abertas ao mesmo tempo: listarUsuarios() com cache frio abre a sua própria.
const abas = vi.hoisted(() => ({ abertas: 0, max: 0 }));
vi.mock('../browser/astrea-http.js', () => ({
  WORKSPACE_PAGE_PATH: '/#/main/workspace/%5B,%5D',
  withBrowserContext: vi.fn(async <T>(op: (page: unknown) => Promise<T>) => {
    abas.abertas++;
    abas.max = Math.max(abas.max, abas.abertas);
    try {
      return await op({});
    } finally {
      abas.abertas--;
    }
  }),
  gapiCall: vi.fn().mockResolvedValue({ items: [{ id: '7', firstName: 'Ana', email: 'ana@x.com' }] }),
  getAstreaUserId: vi.fn().mockResolvedValue('7'),
}));
vi.mock('../browser/navigator.js', () => ({ navigateTo: vi.fn().mockResolvedValue(undefined) }));

import { obterUsuarioLogado } from './usuarios.service.js';

describe('obterUsuarioLogado', () => {
  it('com cache frio nunca segura duas abas ao mesmo tempo (evita travar o pool)', async () => {
    const r = await obterUsuarioLogado();
    expect(r.ok).toBe(true);
    expect(abas.max).toBe(1);
  });
});
