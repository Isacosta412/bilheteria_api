# bilheteria-api

API REST de bilheteria com marcação de assentos para cinema ou casa de eventos.
Trabalho Final de Programação II + Banco de Dados II (Unoesc).

**Stack:** Node.js 20+, TypeScript (strict), Express 5, Prisma 6, PostgreSQL 16, Zod, Vitest + Supertest.

## Como rodar localmente

Pré-requisitos: Node.js 20 ou superior, Docker (com Docker Compose) e npm.

```bash
# 1. Instalar as dependências (também gera o Prisma Client)
npm install

# 2. Criar o .env a partir do modelo (PowerShell: Copy-Item .env.example .env)
cp .env.example .env

# 3. Subir o PostgreSQL 16 local
docker compose up -d

# 4. Aplicar as migrations (a partir da etapa B02)
npm run prisma:migrate

# 5. Rodar em modo desenvolvimento (recarrega ao salvar)
npm run dev
```

Teste rápido: `curl http://localhost:3333/health` → `{"status":"ok","banco":"ok"}`.
Se o banco estiver fora do ar, a rota responde **503** com `{"status":"erro","banco":"erro"}`.

### Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Sobe a API com `tsx watch` (recarrega ao salvar) |
| `npm run build` | `prisma generate` + compila `src/` para `dist/` |
| `npm start` | Roda a versão compilada (`node dist/server.js`) |
| `npm test` | Roda os testes (Vitest + Supertest). Precisa do banco no ar |
| `npm run prisma:migrate` | Cria/aplica migrations em desenvolvimento (`prisma migrate dev`) |
| `npm run prisma:deploy` | Aplica migrations pendentes em produção (`prisma migrate deploy`) |
| `npm run seed` | Popula o banco com dados de demonstração |

### Variáveis de ambiente

Validadas com zod em `src/config/env.ts`. Se faltar alguma ou o valor for inválido, a API **não sobe** e mostra o que corrigir:

```
Error: Variáveis de ambiente inválidas:
 - JWT_SECRET: obrigatória, mas não foi definida
Confira o arquivo .env (use o .env.example como modelo).
```

| Variável | Descrição |
|---|---|
| `NODE_ENV` | `development`, `test` ou `production` (padrão `development`) |
| `PORT` | Porta HTTP (padrão 3333) |
| `DATABASE_URL` | URL do PostgreSQL (em produção, com `?sslmode=require`) |
| `JWT_SECRET` | Segredo do JWT, mínimo 32 caracteres |
| `JWT_EXPIRES_IN` | Validade do token (ex.: `1d`, `12h`) |
| `RESERVA_MINUTOS` | Tempo até a reserva pendente expirar (padrão 10) |
| `CORS_ORIGIN` | Origens permitidas, separadas por vírgula |

## Arquitetura em camadas

```
src/
  config/        env tipado (zod) e singleton do PrismaClient
  routes/        só define rotas e aplica middlewares
  controllers/   lê req, chama o service, devolve res
  services/      toda a regra de negócio; usa repositories; lança AppError
  repositories/  único lugar que usa o Prisma Client
  schemas/       schemas zod dos DTOs de entrada
  middlewares/   auth, autorização por papel, validação zod, erros, rate limit
  jobs/          agendamentos (expiração de reservas) que chamam services
  errors/        AppError e subclasses
  types/         tipos e DTOs de saída
  app.ts         monta o Express (sem listen, usado nos testes)
  server.ts      sobe o servidor HTTP
prisma/          schema.prisma, migrations (inclui SQL customizado) e seed.ts
tests/           testes de integração com Vitest + Supertest
```

Uma requisição percorre as camadas sempre no mesmo sentido:

```
rota → middlewares (validar, auth) → controller → service → repository → Prisma → PostgreSQL
```

| Camada | Responsabilidade | Não pode |
|---|---|---|
| **routes** | Associar método + caminho a um controller e aplicar middlewares | Ter lógica |
| **controllers** | Ler `req` (já validado), chamar o service, escolher o status HTTP e responder | Ter regra de negócio ou importar `prisma` |
| **services** | Regras de negócio, validações de domínio, decidir o que é atômico, lançar `AppError` | Importar `prisma` diretamente |
| **repositories** | Consultar e persistir (`findMany`, `$transaction`, `$queryRaw`...) | Ter `if` de regra de negócio |
| **schemas** | Formato dos dados de entrada (zod); os tipos vêm de `z.infer` | — |
| **middlewares** | Preocupações transversais: validação, autenticação, erros, rate limit | — |

Exemplo real nesta base: `GET /health` → `health.routes.ts` → `healthController.verificar` → `healthService.verificar` → `healthRepository.ping()` (`SELECT 1`).

### Transações

Quem decide o que precisa ser atômico é o **service**; quem executa é o **repository**. O service chama `repository.emTransacao(async (tx) => ...)` e repassa o cliente de transação (`Prisma.TransactionClient`) para os métodos do repository que participam da operação:

```ts
// service (decide e orquestra)
await reservaRepository.emTransacao(async (tx) => {
  const reserva = await reservaRepository.criar(tx, dados);
  const afetados = await sessaoAssentoRepository.reservar(tx, sessaoId, assentoIds, reserva.id, expiraEm);
  if (afetados !== assentoIds.length) {
    throw new Conflito('ASSENTO_INDISPONIVEL', 'Um ou mais assentos não estão disponíveis.'); // rollback
  }
});

// repository (executa)
emTransacao<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}
```

Lançar um erro dentro do callback faz o Prisma dar **rollback** de tudo.

### Erros

Toda resposta de erro tem o formato:

```json
{ "erro": { "codigo": "ASSENTO_INDISPONIVEL", "mensagem": "Um ou mais assentos não estão disponíveis." } }
```

Os services lançam subclasses de `AppError` (`src/errors`), e o `errorHandler` converte:

| Classe / origem | Status | Código padrão |
|---|---|---|
| `DadosInvalidos`, `ZodError` | 400 | `DADOS_INVALIDOS` (com `detalhes` por campo) |
| JSON malformado | 400 | `JSON_INVALIDO` |
| `NaoAutenticado` | 401 | `NAO_AUTENTICADO` |
| `SemPermissao` | 403 | `SEM_PERMISSAO` |
| `NaoEncontrado`, Prisma `P2025`, rota inexistente | 404 | `NAO_ENCONTRADO` / `ROTA_NAO_ENCONTRADA` |
| `Conflito`, Prisma `P2002` / `P2003` | 409 | código informado / `REGISTRO_DUPLICADO` / `VIOLACAO_CHAVE_ESTRANGEIRA` |
| `RegraNegocio` | 422 | código informado |
| Rate limit em `/auth` | 429 | `MUITAS_TENTATIVAS` |
| Qualquer outro erro | 500 | `ERRO_INTERNO` (stack trace só fora de produção) |

### Segurança

- `helmet` nos cabeçalhos HTTP, `cors` restrito às origens do `CORS_ORIGIN`, `express.json` limitado a 100 kB.
- Rate limit de 20 requisições a cada 15 minutos por IP em `/auth/*`.
- Stack trace nunca é devolvido em produção.
