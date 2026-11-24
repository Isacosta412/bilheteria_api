import { z } from 'zod';

export const MAX_ASSENTOS_POR_RESERVA = 10;

/**
 * Nova reserva. O cliente informa SÓ a sessão e os assentos (os `assentoId` do mapa, como número
 * ou string numérica). total, status, expiraEm e usuarioId são calculados pelo servidor:
 * `strictObject` recusa esses campos com 400.
 */
/** Quantos dos assentos são meia-entrada (0 = todos inteira). */
export const meiasSchema = z.coerce
  .number({ message: 'quantidade de meias inválida' })
  .int({ message: 'quantidade de meias inválida' })
  .min(0, { message: 'quantidade de meias inválida' })
  .max(MAX_ASSENTOS_POR_RESERVA, { message: 'quantidade de meias inválida' });

/** As meias não podem passar da quantidade de assentos. */
export function meiasCabemNosAssentos(dados: { assentoIds: unknown[]; meias: number }): boolean {
  return dados.meias <= dados.assentoIds.length;
}
export const MENSAGEM_MEIAS_DEMAIS = 'a quantidade de meias não pode passar da quantidade de assentos';

export const criarReservaCampos = {
  sessaoId: z.coerce.number({ message: 'informe a sessão' }).int().positive({ message: 'sessão inválida' }),
  assentoIds: z
    .array(z.coerce.number({ message: 'assento inválido' }).int().positive({ message: 'assento inválido' }), {
      message: 'informe a lista de assentos',
    })
    .min(1, { message: 'escolha pelo menos 1 assento' })
    .max(MAX_ASSENTOS_POR_RESERVA, { message: `no máximo ${MAX_ASSENTOS_POR_RESERVA} assentos por reserva` })
    .refine((ids) => new Set(ids).size === ids.length, { message: 'há assentos repetidos' }),
  meias: meiasSchema.default(0),
};

export const criarReservaSchema = z
  .strictObject(criarReservaCampos)
  .refine(meiasCabemNosAssentos, { message: MENSAGEM_MEIAS_DEMAIS, path: ['meias'] });
export type CriarReservaEntrada = z.infer<typeof criarReservaSchema>;

/** Troca quantos ingressos da reserva pendente são meia (o total é recalculado no servidor). */
export const alterarMeiasSchema = z.strictObject({ meias: meiasSchema });
export type AlterarMeiasEntrada = z.infer<typeof alterarMeiasSchema>;
