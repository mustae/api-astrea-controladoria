import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { ApiError, ApiResponse, ServiceResponse } from '../types/index.js';

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

export function invalido(res: Response, err: z.ZodError): void {
  const body: ApiError = {
    success: false,
    error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    code: 'VALIDATION_ERROR',
  };
  res.status(400).json(body);
}

/** Converte ServiceResponse → HTTP. Lote com falha parcial vira 207. */
export function responder<T>(res: Response, result: ServiceResponse<T>, statusOk = 200): void {
  if (!result.ok) {
    const body: ApiError = {
      success: false,
      error: result.error.message,
      code: result.error.code,
      ...(result.error.details !== undefined ? { details: result.error.details } : {}),
    };
    res.status(httpStatusDoCodigo(result.error.code)).json(body);
    return;
  }
  const lote = result.data as { falhas?: number; sucesso?: number } | undefined;
  const parcial = typeof lote?.falhas === 'number' && lote.falhas > 0;
  const body: ApiResponse<T> = { success: true, data: result.data };
  res.status(parcial ? 207 : statusOk).json(body);
}

export type Handler = (req: Request, res: Response) => Promise<void>;
export const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
