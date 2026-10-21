import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { listarEtiquetas } from '../services/etiquetas.service.js';
import { booleanQuerySchema, httpStatusDoCodigo } from './query-helpers.js';
import type { ApiError, ApiResponse } from '../types/index.js';

const router = Router();

const querySchema = z.object({
  busca: z.string().optional(),
  incluirInativas: booleanQuerySchema,
  uso: z.enum(['processos', 'tarefas', 'compromissos', 'prazos', 'audiencias', 'andamentos']).optional(),
});

/** GET /api/etiquetas — etiquetas (tags) do escritório. Cache 5 min. */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      const error: ApiError = {
        success: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        code: 'VALIDATION_ERROR',
      };
      res.status(400).json(error);
      return;
    }

    const result = await listarEtiquetas(parsed.data);
    if (!result.ok) {
      const error: ApiError = { success: false, error: result.error.message, code: result.error.code };
      res.status(httpStatusDoCodigo(result.error.code)).json(error);
      return;
    }

    const response: ApiResponse<typeof result.data> = { success: true, data: result.data };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

export default router;
