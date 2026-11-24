import { MetodoPagamento } from '@prisma/client';
import { z } from 'zod';
import { MENSAGEM_MEIAS_DEMAIS, criarReservaCampos, meiasCabemNosAssentos } from './reserva.schema';

/** Venda presencial: os mesmos campos da reserva + método de pagamento + nome opcional do comprador. */
export const venderBalcaoSchema = z.strictObject({
  ...criarReservaCampos,
  metodo: z.enum(MetodoPagamento, { message: 'use DINHEIRO, CARTAO ou PIX' }),
  nomeComprador: z
    .string()
    .trim()
    .min(2, { message: 'o nome deve ter pelo menos 2 letras' })
    .max(120)
    .optional(),
}).refine(meiasCabemNosAssentos, { message: MENSAGEM_MEIAS_DEMAIS, path: ['meias'] });
export type VenderBalcaoEntrada = z.infer<typeof venderBalcaoSchema>;
