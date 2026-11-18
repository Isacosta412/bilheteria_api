import { z } from 'zod';

export const emailSchema = z
  .string({ message: 'informe o e-mail' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'e-mail inválido' }).max(255));

// 72 é o limite de bytes que o bcrypt considera; acima disso o resto seria ignorado em silêncio.
export const senhaSchema = z
  .string({ message: 'informe a senha' })
  .min(8, { message: 'a senha deve ter no mínimo 8 caracteres' })
  .max(72, { message: 'a senha deve ter no máximo 72 caracteres' });

export const nomeSchema = z
  .string({ message: 'informe o nome' })
  .trim()
  .min(2, { message: 'o nome deve ter no mínimo 2 caracteres' })
  .max(120);

/**
 * Cadastro de usuário. `strictObject` recusa campos extras: quem mandar `papel`
 * (ou qualquer campo controlado pelo sistema) recebe 400 em vez de ser ignorado em silêncio.
 */
export const registrarSchema = z.strictObject({
  nome: nomeSchema,
  email: emailSchema,
  senha: senhaSchema,
});
export type RegistrarEntrada = z.infer<typeof registrarSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  // No login não exigimos o mínimo de 8: a resposta precisa ser a mesma para qualquer senha errada.
  senha: z.string({ message: 'informe a senha' }).min(1, { message: 'informe a senha' }).max(72),
});
export type LoginEntrada = z.infer<typeof loginSchema>;

/** Criação de operador por outro operador: mesmos campos do cadastro. */
export const criarOperadorSchema = registrarSchema;
export type CriarOperadorEntrada = RegistrarEntrada;
