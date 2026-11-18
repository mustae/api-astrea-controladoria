import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Credenciais do Astrea
  ASTREA_EMAIL: z.string().email('ASTREA_EMAIL deve ser um e-mail válido'),
  ASTREA_PASSWORD: z.string().min(1, 'ASTREA_PASSWORD é obrigatório'),

  // Autenticação da API. Aceita uma OU outra (lista é a forma recomendada,
  // permite uma chave por pessoa com rótulo para auditoria/rotação):
  //   API_KEY=chave_unica_de_no_minimo_32_caracteres        (legada, label `legacy`)
  //   API_KEYS=chave1:label1,chave2:label2,chave3            (≥32 chars por chave)
  API_KEY: z.string().min(32, 'API_KEY deve ter pelo menos 32 caracteres').optional(),
  API_KEYS: z.string().optional(),

  // Configurações do servidor
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Configurações do pool de browsers
  // Teto = 5 propositalmente: cada Chromium extra custa ~250 MB RAM E aumenta
  // o risco de a Astrea (servidor externo) detectar uso indevido da conta
  // (múltiplas abas paralelas na mesma sessão logada). Pool > 5 não é seguro.
  BROWSER_POOL_SIZE: z.coerce.number().int().min(1).max(5).default(3),
  BROWSER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // Timeout DEDICADO da espera pós-login (clicar "Entrar" → SPA chegar em #/main/).
  // Separado de BROWSER_TIMEOUT_MS: o cold-start do Chromium + boot da SPA tem
  // cauda observada de ~27s (mediana ~12s) perto do teto antigo de 30s; 45s cobre
  // a cauda sem afrouxar o timeout das operações nem custar logins extras.
  BROWSER_LOGIN_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  // Circuit breaker de login: corta a tempestade de re-logins (uso indevido na
  // Astrea). Abre após N falhas consecutivas e segura novos logins por cooldown.
  LOGIN_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(3),
  LOGIN_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(0).default(60000),
  // Orçamento de logins pela tela para QUALQUER gatilho (ver browser/relogin-budget.ts):
  // o breaker acima só conta falhas; este teto segura tempestade de logins BEM-sucedidos
  // (outra sessão disputando a conta — o Astrea mantém 1 sessão por usuário).
  RELOGIN_MAX_POR_JANELA: z.coerce.number().int().min(1).default(3),
  RELOGIN_JANELA_MS: z.coerce.number().int().min(1000).default(600_000),
  RELOGIN_BLOQUEIO_MS: z.coerce.number().int().min(1000).default(600_000),
  RELOGIN_BLOQUEIO_MAX_MS: z.coerce.number().int().min(1000).default(1_800_000),
  BROWSER_IDLE_TTL_MS: z.coerce.number().int().min(0).default(900000),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),
  BROWSER_HEADLESS: z
    .string()
    .transform((v) => v !== 'false')
    .default(true),

  // Configurações de sessão
  // SESSION_REUSE (agora EFETIVAMENTE lido): liga a persistência do storageState
  // em disco, permitindo restaurar a sessão no cold-start em vez de re-logar.
  SESSION_REUSE: z
    .string()
    .transform((v) => v !== 'false')
    .default(true),
  /** Caminho do arquivo de storageState; default = tmpdir/astrea-session.json. */
  SESSION_STATE_PATH: z.string().optional(),
  /** Idade máxima da sessão persistida antes de exigir re-login (default 6h). */
  SESSION_STATE_MAX_AGE_MS: z.coerce.number().int().min(0).default(21_600_000),

  // Rate limiting (por IP, retorna 429 + Retry-After quando excedido)
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(50),

  // Fila de requisições (RequestQueue)
  QUEUE_MAX_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  QUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

  // Quadro Kanban padrão de cada tipo de atividade criada pela API (ver kanban-destino.ts):
  // "padrao" (quadro marcado como padrão no Astrea), "nenhum", "Quadro" ou "Quadro > Coluna"
  // (nome ou id). Ausente: tarefa/prazo = padrao; audiência = AUDIENCIAS & PERICIAS;
  // compromisso = nenhum.
  KANBAN_TAREFA: z.string().optional(),
  KANBAN_PRAZO: z.string().optional(),
  KANBAN_AUDIENCIA: z.string().optional(),
  KANBAN_COMPROMISSO: z.string().optional(),
  // Etiqueta posta em toda audiência criada (nome ou id; "nenhuma" desliga). Ausente: "Audiência".
  ETIQUETA_AUDIENCIA: z.string().optional(),
  // Regras pela natureza (ver regras-natureza.ts), formato "chave1,chave2=Alvo; chave3=Alvo";
  // "nenhuma" desliga. Ausentes: as regras do escritório de 26/10/2026.
  // Responsável padrão de prazo/audiência/tarefa pela etiqueta de área (alvo: id, e-mail ou nome do usuário).
  RESPONSAVEL_POR_ETIQUETA: z.string().optional(),
  // Quadro Kanban de prazo/tarefa pelo cliente do processo (alvo: "Quadro" ou "Quadro > Coluna").
  KANBAN_POR_CLIENTE: z.string().optional(),

  // Tenant do Astrea (necessário para chamadas GCP Endpoints / users API). Sem default:
  // um tenant de outro escritório só aparecia depois, como 403.
  ASTREA_TENANT_ID: z.string().regex(/^\d+$/, 'ASTREA_TENANT_ID é obrigatório (id numérico do escritório no Astrea)'),

});

function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${errors}`);
  }

  if (!result.data.API_KEY && !result.data.API_KEYS) {
    throw new Error(
      'Configuração de ambiente inválida:\n  - API_KEY: defina API_KEY ou API_KEYS (≥32 chars por chave)',
    );
  }

  return result.data;
}

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
