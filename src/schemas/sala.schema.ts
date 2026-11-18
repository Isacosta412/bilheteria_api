import { z } from 'zod';

const filaSchema = z
  .string({ message: 'informe a fila' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,2}$/, { message: 'a fila deve ter 1 ou 2 letras (ex.: A, B, AA)' });

const posicaoSchema = z.strictObject({
  fila: filaSchema,
  numero: z.number({ message: 'informe o número do assento' }).int().positive(),
});
export type PosicaoAssento = z.infer<typeof posicaoSchema>;

const nomeSalaSchema = z
  .string({ message: 'informe o nome da sala' })
  .trim()
  .min(1, { message: 'informe o nome da sala' })
  .max(60, { message: 'o nome da sala deve ter no máximo 60 caracteres' });

/**
 * Estrutura da sala. Informe EXATAMENTE UM entre:
 *   - filas: ["A", "B", ..., "J"]   (nomes das filas)
 *   - qtdFilas: 10                  (gera A, B, C, ...)
 * e sempre assentosPorFila. PCD/VIP são opcionais e precisam existir no layout.
 */
const camposEstrutura = {
  assentosPorFila: z
    .number({ message: 'informe a quantidade de assentos por fila' })
    .int()
    .min(1, { message: 'cada fila precisa de pelo menos 1 assento' })
    .max(40, { message: 'no máximo 40 assentos por fila' }),
  filas: z
    .array(filaSchema)
    .min(1, { message: 'informe ao menos uma fila' })
    .max(26, { message: 'no máximo 26 filas' })
    .optional(),
  qtdFilas: z.number().int().min(1, { message: 'informe ao menos uma fila' }).max(26, { message: 'no máximo 26 filas' }).optional(),
  assentosPcd: z.array(posicaoSchema).max(200).optional(),
  assentosVip: z.array(posicaoSchema).max(200).optional(),
};

interface CamposEstrutura {
  filas?: string[] | undefined;
  qtdFilas?: number | undefined;
}

function validarEstrutura(valor: CamposEstrutura, ctx: z.RefinementCtx): void {
  const temFilas = valor.filas !== undefined;
  const temQtd = valor.qtdFilas !== undefined;
  if (temFilas === temQtd) {
    ctx.addIssue({
      code: 'custom',
      path: ['filas'],
      message: 'informe exatamente um entre "filas" (lista de nomes) e "qtdFilas" (quantidade)',
    });
  }
  if (valor.filas && new Set(valor.filas).size !== valor.filas.length) {
    ctx.addIssue({ code: 'custom', path: ['filas'], message: 'há filas repetidas' });
  }
}

export const estruturaSalaSchema = z.strictObject(camposEstrutura).superRefine(validarEstrutura);
export type EstruturaSala = z.infer<typeof estruturaSalaSchema>;

export const criarSalaSchema = z
  .strictObject({ nome: nomeSalaSchema, ...camposEstrutura })
  .superRefine(validarEstrutura);
export type CriarSalaEntrada = z.infer<typeof criarSalaSchema>;

export const atualizarSalaSchema = z.strictObject({
  nome: nomeSalaSchema,
  ativa: z.boolean({ message: 'informe se a sala está ativa (true/false)' }),
  /** Opcional: só quando o layout de assentos muda. */
  estrutura: estruturaSalaSchema.optional(),
});
export type AtualizarSalaEntrada = z.infer<typeof atualizarSalaSchema>;
