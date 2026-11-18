import type { Request, Response } from 'express';
import { healthService } from '../services/health.service';
import type { StatusSaude } from '../types/health';

export const healthController = {
  async verificar(_req: Request, res: Response<StatusSaude>): Promise<void> {
    const saude = await healthService.verificar();
    res.status(saude.status === 'ok' ? 200 : 503).json(saude);
  },
};
