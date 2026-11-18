# B01 – Estrutura inicial do projeto

> Cole no Claude Code, na raiz do repositório `bilheteria-api` (com o CLAUDE.md já copiado).

```
Leia o CLAUDE.md inteiro antes de começar. Use o Plan Mode e me mostre o plano antes de criar os arquivos.

Tarefa: criar a estrutura inicial do backend.

1. Inicialize o projeto Node + TypeScript (strict, target ES2022, módulo CommonJS ou NodeNext, como preferir; justifique a escolha) com as dependências listadas no CLAUDE.md.
2. Crie a estrutura de pastas exatamente como descrita na seção "Arquitetura em camadas".
3. Implemente:
   - src/config/env.ts: validação das variáveis de ambiente com zod (a aplicação deve falhar na inicialização com uma mensagem clara se faltar alguma);
   - src/config/prisma.ts: singleton do PrismaClient;
   - src/errors: AppError (com codigo, mensagem e statusHttp) e as subclasses NaoEncontrado (404), Conflito (409), RegraNegocio (422), NaoAutenticado (401), SemPermissao (403), DadosInvalidos (400);
   - middlewares: errorHandler (converte AppError, ZodError e erros conhecidos do Prisma, como P2002 → 409, para o formato de erro do CLAUDE.md, sem vazar stack trace em produção), validar(schema) para body/params/query, notFound;
   - app.ts com helmet, cors (origem vinda do env), express.json, rate limit nas rotas de autenticação, rota GET /health que responde { status: "ok", banco: "ok" } testando o banco com SELECT 1;
   - server.ts que sobe o app.
4. Crie o docker-compose.yml com PostgreSQL 16 para desenvolvimento local, o .env.example, o .gitignore (node_modules, dist, .env) e os scripts npm do CLAUDE.md.
5. Configure o vitest + supertest com um teste do /health.
6. Escreva um README.md inicial: como rodar localmente e a explicação das camadas.

Ao final, rode `docker compose up -d`, `npm run build` e `npm test` e me mostre o resultado.
```
