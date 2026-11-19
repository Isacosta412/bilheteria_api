import 'dotenv/config';
import { z } from 'zod';

/**
 * Variáveis de ambiente validadas na inicialização.
 * Se alguma estiver ausente ou inválida, a aplicação não sobe e mostra exatamente o que corrigir.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((valor) => /^postgres(ql)?:\/\//.test(valor), {
      message: 'deve ser uma URL do PostgreSQL (postgresql://...)',
    }),
  JWT_SECRET: z.string().min(32, { message: 'deve ter pelo menos 32 caracteres' }),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]?$/, { message: 'use um número de segundos ou formatos como 15m, 12h, 1d' }),
  RESERVA_MINUTOS: z.coerce.number().int().positive().default(10),
  // Quantos minutos antes do início da sessão a entrada já pode ser validada (padrão 60).
  // Para uma demonstração, um valor alto (ex.: 100000) libera a validação de qualquer sessão futura.
  VALIDACAO_ANTECEDENCIA_MINUTOS: z.coerce.number().int().min(0).default(60),
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform((valor) =>
      valor
        .split(',')
        .map((origem) => origem.trim())
        .filter((origem) => origem.length > 0),
    )
    .pipe(z.array(z.string()).min(1, { message: 'informe ao menos uma origem' })),
});

export type Env = z.infer<typeof envSchema>;

function carregarEnv(fonte: NodeJS.ProcessEnv): Env {
  const resultado = envSchema.safeParse(fonte);
  if (resultado.success) {
    return resultado.data;
  }

  const linhas = resultado.error.issues.map((issue) => {
    const variavel = issue.path.join('.') || '(raiz)';
    const ausente = typeof issue.path[0] === 'string' && fonte[issue.path[0]] === undefined;
    return ` - ${variavel}: ${ausente ? 'obrigatória, mas não foi definida' : issue.message}`;
  });

  throw new Error(
    `Variáveis de ambiente inválidas:\n${linhas.join('\n')}\n` +
      'Confira o arquivo .env (use o .env.example como modelo).',
  );
}

export const env: Env = carregarEnv(process.env);
