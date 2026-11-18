import { execSync } from 'node:child_process';

/**
 * Roda uma vez antes de todos os testes: aplica as migrations pendentes no banco de teste
 * (`prisma migrate deploy`, que não apaga dados). Cada arquivo de teste limpa as tabelas
 * com `limparBanco()` (tests/helpers/banco.ts). Nunca aponta para o banco de desenvolvimento.
 */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ??
    'postgresql://bilheteria:bilheteria@localhost:5433/bilheteria_test?schema=public';

  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Por segurança, o banco de teste precisa ter "test" no nome: ${url}`);
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
