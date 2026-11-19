import { MetodoPagamento } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';

const metodoApp = z.enum([MetodoPagamento.PIX, MetodoPagamento.CARTAO], {
  message: 'pelo app, o pagamento é por PIX ou CARTAO',
});

/**
 * Pagamento pelo app. O valor NUNCA vem do cliente (é o total da reserva): `strictObject` recusa
 * valor/total/status com 400. `simularFalha` só existe fora de produção (demonstração do rollback).
 */
export const pagarReservaSchema =
  env.NODE_ENV === 'production'
    ? z.strictObject({ metodo: metodoApp }).transform((d) => ({ ...d, simularFalha: false }))
    : z.strictObject({ metodo: metodoApp, simularFalha: z.boolean().default(false) });

export type PagarReservaEntrada = z.infer<typeof pagarReservaSchema>;
