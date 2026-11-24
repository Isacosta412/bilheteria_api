import { FormatoSessao, IdiomaSessao } from '@prisma/client';
import { z } from 'zod';
import { booleanoQuery, dataHoraIso, diaIso, dinheiro } from './comum';

const idSchema = (campo: string) =>
  z.number({ message: `informe ${campo}` }).int().positive({ message: `${campo} inválido` });

/** Nova sessão. O operador escolhe filme e sala (por nome, no app); a API recebe os ids. */
export const criarSessaoSchema = z.strictObject({
  filmeId: idSchema('o filme'),
  salaId: idSchema('a sala'),
  dataHora: dataHoraIso,
  preco: dinheiro,
  formato: z.enum(FormatoSessao, { message: 'use DOIS_D ou TRES_D' }).default(FormatoSessao.DOIS_D),
  idioma: z.enum(IdiomaSessao, { message: 'use DUBLADO ou LEGENDADO' }).default(IdiomaSessao.DUBLADO),
});
export type CriarSessaoEntrada = z.infer<typeof criarSessaoSchema>;

/** Troca o formato e/ou o idioma de uma sessão (não mexe em horário, sala nem preço). */
export const atualizarSessaoSchema = z
  .strictObject({
    formato: z.enum(FormatoSessao, { message: 'use DOIS_D ou TRES_D' }).optional(),
    idioma: z.enum(IdiomaSessao, { message: 'use DUBLADO ou LEGENDADO' }).optional(),
  })
  .refine((d) => d.formato !== undefined || d.idioma !== undefined, { message: 'informe o formato ou o idioma' });
export type AtualizarSessaoEntrada = z.infer<typeof atualizarSessaoSchema>;

const idQuery = z.coerce.number().int().positive().optional();

export const listarSessoesQuerySchema = z.object({
  filmeId: idQuery,
  salaId: idQuery,
  /** Dia (AAAA-MM-DD) no horário de Brasília. */
  data: diaIso.optional(),
  incluirPassadas: booleanoQuery.default(false),
  incluirCanceladas: booleanoQuery.default(false),
});
export type ListarSessoesQuery = z.infer<typeof listarSessoesQuerySchema>;
