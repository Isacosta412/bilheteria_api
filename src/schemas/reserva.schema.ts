import { z } from 'zod';

export const MAX_ASSENTOS_POR_RESERVA = 10;

/**
 * Nova reserva. O cliente informa SÓ a sessão e os assentos (os `assentoId` do mapa, como número
 * ou string numérica). total, status, expiraEm e usuarioId são calculados pelo servidor:
 * `strictObject` recusa esses campos com 400.
 */
export const criarReservaSchema = z.strictObject({
  sessaoId: z.coerce.number({ message: 'informe a sessão' }).int().positive({ message: 'sessão inválida' }),
  assentoIds: z
    .array(z.coerce.number({ message: 'assento inválido' }).int().positive({ message: 'assento inválido' }), {
      message: 'informe a lista de assentos',
    })
    .min(1, { message: 'escolha pelo menos 1 assento' })
    .max(MAX_ASSENTOS_POR_RESERVA, { message: `no máximo ${MAX_ASSENTOS_POR_RESERVA} assentos por reserva` })
    .refine((ids) => new Set(ids).size === ids.length, { message: 'há assentos repetidos' }),
});
export type CriarReservaEntrada = z.infer<typeof criarReservaSchema>;
