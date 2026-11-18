import { z } from 'zod';

/** :id numérico na URL. */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive({ message: 'id inválido' }),
});
export type IdParam = z.infer<typeof idParamSchema>;

/** Booleano vindo da query string (?ativo=true). */
export const booleanoQuery = z
  .enum(['true', 'false'], { message: 'use true ou false' })
  .transform((valor) => valor === 'true');

/** Valor em reais: positivo e com no máximo 2 casas decimais. */
export const dinheiro = z
  .number({ message: 'informe um número' })
  .positive({ message: 'deve ser maior que zero' })
  .max(99_999_999.99)
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6, {
    message: 'use no máximo 2 casas decimais',
  });

/** Data/hora ISO 8601 com fuso (ex.: 2026-11-24T19:30:00-03:00 ou ...Z). */
export const dataHoraIso = z.iso
  .datetime({ offset: true, message: 'use o formato ISO 8601 com fuso, ex.: 2026-11-24T19:30:00-03:00' })
  .transform((valor) => new Date(valor));

/** Dia no formato YYYY-MM-DD. */
export const diaIso = z.iso.date({ message: 'use o formato AAAA-MM-DD' });
