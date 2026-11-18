// ─────────────────────────────────────────────────────────────────────────────
// Regras pela "natureza" da atividade (decisão do escritório, 26/10/2026)
//
// A natureza vem das etiquetas do item e do processo vinculado (a publicação tratada
// sempre é vinculada a um processo, que carrega a etiqueta da área) e dos clientes
// do processo.
//
//   • Responsável padrão por área (RESPONSAVEL_POR_ETIQUETA):
//       Trabalhista → Charles; Previdenciário → Mariane;
//       Cível/Família/Tributário/Criminal → Diego.
//     A etiqueta casa por palavra ("Cível" pega "3 CIVEL"). Etiqueta do item vence a do processo. Áreas de advogados diferentes no mesmo
//     nível são ambíguas: fica o padrão (usuário da integração) e um aviso no log.
//   • Quadro por cliente (KANBAN_POR_CLIENTE): cliente SINDISMED → "Demandas do SINDISMED".
//
// Formato das duas variáveis: "chave1,chave2=Alvo; chave3=Alvo"; "nenhuma" desliga.
// Alvo do responsável: id, e-mail ou nome do usuário (todas as palavras, sem acento/caixa).
// O que o assistente informar na chamada (responsavelId, kanban) sempre vence.
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { astreaApiGet, getAstreaUserId } from '../browser/astrea-http.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { etiquetasDoTenant } from './etiqueta-automatica.js';
import { listarUsuarios } from './usuarios.service.js';
import { semAcento } from '../utils/sanitize.js';

// Por e-mail: há dois usuários "DIEGO MONTEIRO ROCHA" no Astrea do escritório.
const PADRAO_RESPONSAVEL =
  'Trabalhista=charles@srsadvogados.adv.br; Previdenciário=mariane@srsadvogados.adv.br; ' +
  'Cível,Família,Tributário,Criminal=diego@srsadvogados.adv.br';
const PADRAO_QUADRO = 'SINDISMED=Demandas do SINDISMED';

export interface Natureza {
  /** Nomes das etiquetas informadas para a atividade. */
  etiquetasItem: string[];
  /** Nomes das etiquetas do processo vinculado. */
  etiquetasProcesso: string[];
  /** Nomes dos clientes do processo vinculado. */
  clientes: string[];
}

interface RawFolder {
  tagIds?: Array<number | string>;
  customers?: Array<{ name?: string }>;
  customer?: { contactName?: string };
}


export function lerMapa(valor: string | undefined): Array<{ chaves: string[]; alvo: string }> {
  const v = (valor ?? '').trim();
  if (!v || semAcento(v) === 'nenhuma') return [];
  return v.split(';').flatMap((par) => {
    const i = par.indexOf('=');
    if (i < 0) return [];
    const chaves = par.slice(0, i).split(',').map(semAcento).filter(Boolean);
    const alvo = par.slice(i + 1).trim();
    return chaves.length && alvo ? [{ chaves, alvo }] : [];
  });
}

export async function naturezaDoProcesso(
  page: Page,
  processoId: string | undefined,
  tagIdsItem: string[] = [],
): Promise<Natureza> {
  let folder: RawFolder = {};
  if (processoId) {
    try {
      const userId = await getAstreaUserId(page);
      folder = (await astreaApiGet<RawFolder>(page, `/folder/${processoId}?userId=${userId}&withDetails=true`)) ?? {};
    } catch (err) {
      logger.warn({ processoId, err: String(err) }, 'Natureza: não foi possível ler o processo; regras só pelas etiquetas do item');
    }
  }
  const tags = await etiquetasDoTenant(page);
  const nomes = (ids: Array<number | string>) =>
    ids.flatMap((id) => {
      const label = tags.find((t) => String(t.id) === String(id))?.label;
      return label ? [label] : [];
    });
  const clientes = [
    ...(folder.customers ?? []).map((c) => c.name ?? ''),
    ...(folder.customer?.contactName ? [folder.customer.contactName] : []),
  ].filter(Boolean);
  return {
    etiquetasItem: nomes(tagIdsItem),
    etiquetasProcesso: nomes(folder.tagIds ?? []),
    clientes: [...new Set(clientes)],
  };
}

const palavras = (s: string) => semAcento(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Alvos das regras cujas chaves batem com alguma etiqueta (sem repetição). A etiqueta
 * casa se contém todas as palavras da chave: "Cível" pega "3 CIVEL" e
 * "6 CIVEL - DEMANDA DIVERSA" (nomes reais do escritório têm prefixo numérico).
 */
function alvosPorEtiqueta(etiquetas: string[], mapa: ReturnType<typeof lerMapa>): string[] {
  const nomes = etiquetas.map(palavras);
  const casa = (chave: string) => nomes.some((nome) => palavras(chave).every((p) => nome.includes(p)));
  return [...new Set(mapa.filter((r) => r.chaves.some(casa)).map((r) => r.alvo))];
}

async function idDoUsuario(alvo: string): Promise<string | null> {
  const r = await listarUsuarios();
  const usuarios = r.ok ? r.data : [];
  const exato = usuarios.find((u) => u.id === alvo.trim() || semAcento(u.email ?? '') === semAcento(alvo));
  if (exato) return exato.id;
  const palavras = semAcento(alvo).split(/\s+/);
  const achados = usuarios.filter((u) => {
    const nome = semAcento(u.nome).split(/\s+/);
    return palavras.every((p) => nome.includes(p));
  });
  if (achados.length !== 1) {
    logger.warn({ alvo, encontrados: achados.map((u) => u.nome) }, 'Regra de responsável: usuário não encontrado ou ambíguo');
    return null;
  }
  return achados[0].id;
}

/** Id do advogado da área (etiqueta do item, senão do processo), ou null. */
export async function responsavelDaNatureza(
  n: Natureza,
  regras: string | undefined = env.RESPONSAVEL_POR_ETIQUETA ?? PADRAO_RESPONSAVEL,
): Promise<string | null> {
  const mapa = lerMapa(regras);
  for (const etiquetas of [n.etiquetasItem, n.etiquetasProcesso]) {
    const alvos = alvosPorEtiqueta(etiquetas, mapa);
    if (alvos.length > 1) {
      logger.warn({ etiquetas, alvos }, 'Regra de responsável ambígua (áreas de advogados diferentes); mantido o padrão');
      return null;
    }
    if (alvos.length === 1) return idDoUsuario(alvos[0]);
  }
  return null;
}

/** Quadro ("Quadro" ou "Quadro > Coluna") pelo cliente do processo, ou undefined. */
export function quadroDaNatureza(
  n: Natureza,
  regras: string | undefined = env.KANBAN_POR_CLIENTE ?? PADRAO_QUADRO,
): string | undefined {
  const clientes = n.clientes.map(semAcento);
  return lerMapa(regras).find((r) => r.chaves.some((c) => clientes.some((nome) => nome.includes(c))))?.alvo;
}

/** Responsável e quadro pelas regras; só lê o processo se algo ficou em aberto na chamada. */
export async function aplicarRegrasDaNatureza(
  page: Page,
  processoId: string | undefined,
  tagIds: string[],
  precisa: { responsavel: boolean; quadro: boolean },
): Promise<{ responsavelId?: string; quadro?: string }> {
  if (!precisa.responsavel && !precisa.quadro) return {};
  if (!processoId && !tagIds.length) return {};
  const n = await naturezaDoProcesso(page, processoId, tagIds);
  const responsavelId = precisa.responsavel ? await responsavelDaNatureza(n) : null;
  const quadro = precisa.quadro ? quadroDaNatureza(n) : undefined;
  if (responsavelId || quadro) logger.info({ processoId, responsavelId, quadro }, 'Regras pela natureza aplicadas');
  return { ...(responsavelId ? { responsavelId } : {}), ...(quadro ? { quadro } : {}) };
}
