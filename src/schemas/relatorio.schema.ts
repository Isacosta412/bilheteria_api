import { z } from 'zod';
import { diaIso } from './comum';

const idQuery = z.coerce.number().int().positive().optional();

/** Período em dias de Brasília (AAAA-MM-DD, inclusive). Sem datas: de 30 dias atrás a 30 dias à frente. */
const periodo = {
  inicio: diaIso.optional(),
  fim: diaIso.optional(),
};

export const relatorioSessoesQuerySchema = z.object({
  ...periodo,
  filmeId: idQuery,
  salaId: idQuery,
});
export type RelatorioSessoesQuery = z.infer<typeof relatorioSessoesQuerySchema>;

export const relatorioVendasQuerySchema = z.object({
  ...periodo,
  agrupar: z.enum(['dia', 'filme', 'metodo'], { message: 'agrupar deve ser dia, filme ou metodo' }).default('dia'),
});
export type RelatorioVendasQuery = z.infer<typeof relatorioVendasQuerySchema>;
