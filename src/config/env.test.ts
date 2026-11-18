import { afterEach, expect, it, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([undefined, 'false', 'true'])('preserva os booleanos da configuração com valor %s', async (value) => {
  vi.stubEnv('BROWSER_HEADLESS', value);
  vi.stubEnv('SESSION_REUSE', value);
  if (value === undefined) {
    delete process.env.BROWSER_HEADLESS;
    delete process.env.SESSION_REUSE;
  }
  const { env } = await import('./env.js');
  expect(env.BROWSER_HEADLESS).toBe(value !== 'false');
  expect(env.SESSION_REUSE).toBe(value !== 'false');
});

it('ASTREA_TENANT_ID é obrigatório (o antigo default era o tenant de outro escritório → 403)', async () => {
  vi.stubEnv('ASTREA_TENANT_ID', '');
  delete process.env.ASTREA_TENANT_ID;
  await expect(import('./env.js')).rejects.toThrow(/ASTREA_TENANT_ID/);
});

it('explica configuração inválida sem falhar ao formatar os erros', async () => {
  vi.stubEnv('BROWSER_POOL_SIZE', '6');
  await expect(import('./env.js')).rejects.toThrow(/Configuração de ambiente inválida:[\s\S]*BROWSER_POOL_SIZE/);
});
