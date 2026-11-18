import { defineConfig } from 'vitest/config';

// Banco exclusivo dos testes (recriado a cada execução pelo tests/global-setup.ts).
// No CI, defina TEST_DATABASE_URL apontando para o Postgres do pipeline.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://bilheteria:bilheteria@localhost:5433/bilheteria_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
    },
    restoreMocks: true,
    // Os testes compartilham o mesmo banco: rodar os arquivos em sequência evita interferência entre eles.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
