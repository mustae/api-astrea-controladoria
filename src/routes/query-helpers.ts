import { z } from 'zod';

/**
 * IDs do Astrea na query string: aceita CSV ("1,2") ou parâmetro repetido
 * (?x=1&x=2) e devolve string[] (IDs do Astrea passam de 2^53 em alguns casos;
 * a conversão numérica acontece no service, com validação de precisão).
 */
export const idsStringArraySchema = z
  .preprocess((val) => {
    if (val == null || val === '') return undefined;
    const arr = Array.isArray(val) ? val : String(val).split(',');
    const limpos = arr.map((s) => String(s).trim()).filter(Boolean);
    return limpos.length ? limpos : undefined;
  }, z.array(z.string().regex(/^\d+$/, 'ID deve ser numérico')))
  .optional();

/** "true"/"1" → true, "false"/"0" → false. */
export const booleanQuerySchema = z
  .preprocess((val) => {
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return val;
  }, z.boolean())
  .optional();

/** Status HTTP para os códigos de ServiceError. */
export function httpStatusDoCodigo(code: string): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'BROWSER_UNAVAILABLE':
    case 'SESSION_EXPIRED':
      return 503;
    case 'TIMEOUT':
      return 504;
    default:
      return 500;
  }
}
