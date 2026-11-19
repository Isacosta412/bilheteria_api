import { z } from 'zod';

const codigo = z
  .string({ message: 'informe o código do ingresso' })
  .trim()
  .min(1, { message: 'informe o código do ingresso' })
  .max(40);

export const validarIngressoSchema = z.strictObject({ codigo });
export type ValidarIngressoEntrada = z.infer<typeof validarIngressoSchema>;

export const codigoParamSchema = z.object({ codigo });
export type CodigoParam = z.infer<typeof codigoParamSchema>;
