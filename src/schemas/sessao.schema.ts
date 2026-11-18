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
});
export type CriarSessaoEntrada = z.infer<typeof criarSessaoSchema>;

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
