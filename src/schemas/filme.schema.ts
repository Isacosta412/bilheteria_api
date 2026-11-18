import { Classificacao } from '@prisma/client';
import { z } from 'zod';
import { DURACAO_MAXIMA_MINUTOS } from '../config/constantes';
import { booleanoQuery } from './comum';

const texto = (campo: string, max: number) =>
  z
    .string({ message: `informe ${campo}` })
    .trim()
    .min(1, { message: `informe ${campo}` })
    .max(max, { message: `${campo} deve ter no máximo ${max} caracteres` });

/** Campos editáveis de um filme (id, ativo e datas são controlados pelo sistema). */
export const filmeSchema = z.strictObject({
  titulo: texto('o título', 200),
  sinopse: texto('a sinopse', 5000),
  duracaoMinutos: z
    .number({ message: 'informe a duração em minutos' })
    .int({ message: 'a duração deve ser um número inteiro de minutos' })
    .min(1, { message: 'a duração deve ser maior que zero' })
    .max(DURACAO_MAXIMA_MINUTOS, { message: `a duração máxima é de ${DURACAO_MAXIMA_MINUTOS} minutos` }),
  classificacao: z.enum(Classificacao, { message: 'classificação inválida' }),
  genero: texto('o gênero', 60),
  posterUrl: z.url({ message: 'URL do pôster inválida' }).max(500).nullable().optional(),
});
export type FilmeEntrada = z.infer<typeof filmeSchema>;

export const alterarAtivoSchema = z.strictObject({
  ativo: z.boolean({ message: 'informe true ou false' }),
});
export type AlterarAtivoEntrada = z.infer<typeof alterarAtivoSchema>;

export const listarFilmesQuerySchema = z.object({
  ativo: booleanoQuery.optional(),
  busca: z.string().trim().min(1).max(100).optional(),
});
export type ListarFilmesQuery = z.infer<typeof listarFilmesQuerySchema>;
