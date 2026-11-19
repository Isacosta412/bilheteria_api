import type { Request, Response } from 'express';
import { lerQuery } from '../middlewares/validar';
import type { RelatorioSessoesQuery, RelatorioVendasQuery } from '../schemas/relatorio.schema';
import { relatorioService } from '../services/relatorio.service';
import type { RelatorioSessoesDTO, RelatorioVendasDTO } from '../types/relatorio';

export const relatorioController = {
  async sessoes(req: Request, res: Response<RelatorioSessoesDTO>): Promise<void> {
    res.json(await relatorioService.sessoes(lerQuery<RelatorioSessoesQuery>(req)));
  },

  async sessoesCsv(req: Request, res: Response): Promise<void> {
    const { nomeArquivo, conteudo } = await relatorioService.sessoesCsv(lerQuery<RelatorioSessoesQuery>(req));
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      })
      .send(conteudo);
  },

  async vendas(req: Request, res: Response<RelatorioVendasDTO>): Promise<void> {
    res.json(await relatorioService.vendas(lerQuery<RelatorioVendasQuery>(req)));
  },
};
