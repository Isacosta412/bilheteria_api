/**
 * Seed – rodar com: npm run seed   (também roda após `prisma migrate reset`)
 *
 * Idempotente (upsert): pode ser executado várias vezes sem duplicar dados.
 * Nesta etapa cria apenas o primeiro OPERADOR, com credenciais vindas do .env.
 * Os dados de demonstração (filmes, salas, sessões, vendas) entram na etapa B08.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Papel, PrismaClient } from '@prisma/client';
import { z } from 'zod';

const envSeedSchema = z.object({
  SEED_OPERADOR_NOME: z.string().trim().min(2).default('Operador'),
  SEED_OPERADOR_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  SEED_OPERADOR_SENHA: z.string().min(8, { message: 'deve ter pelo menos 8 caracteres' }).max(72),
});

function lerEnvSeed(): z.infer<typeof envSeedSchema> {
  const resultado = envSeedSchema.safeParse(process.env);
  if (!resultado.success) {
    const linhas = resultado.error.issues.map((issue) => {
      const variavel = issue.path.join('.');
      const ausente = process.env[variavel] === undefined;
      return ` - ${variavel}: ${ausente ? 'obrigatória, mas não foi definida' : issue.message}`;
    });
    throw new Error(`Variáveis do seed inválidas:\n${linhas.join('\n')}\nConfira o .env (modelo em .env.example).`);
  }
  return resultado.data;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const env = lerEnvSeed();
  const senhaHash = await bcrypt.hash(env.SEED_OPERADOR_SENHA, 10);

  const operador = await prisma.usuario.upsert({
    where: { email: env.SEED_OPERADOR_EMAIL },
    create: { nome: env.SEED_OPERADOR_NOME, email: env.SEED_OPERADOR_EMAIL, senhaHash, papel: Papel.OPERADOR },
    // Reexecutar o seed sincroniza nome, senha e papel com o .env.
    update: { nome: env.SEED_OPERADOR_NOME, senhaHash, papel: Papel.OPERADOR },
    select: { id: true, email: true },
  });

  console.log(`Seed concluído: operador ${operador.email} (id ${operador.id}).`);
}

main()
  .catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
