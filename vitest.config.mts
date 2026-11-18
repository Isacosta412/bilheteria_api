import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    env: { NODE_ENV: 'test' },
    restoreMocks: true,
    // Os testes usam o mesmo banco: rodar os arquivos em sequência evita interferência entre eles.
    fileParallelism: false,
  },
});
