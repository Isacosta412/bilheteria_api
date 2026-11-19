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

# 4. Aplicar as migrations
npm run prisma:migrate

# 5. Criar o primeiro OPERADOR (credenciais SEED_OPERADOR_* do .env)
npm run seed

# 6. Rodar em modo desenvolvimento (recarrega ao salvar)
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
| `npm test` | Roda os testes (Vitest + Supertest) no banco `bilheteria_test`. Precisa do Docker no ar |
| `npm run prisma:migrate` | Cria/aplica migrations em desenvolvimento (`prisma migrate dev`) |
| `npm run prisma:deploy` | Aplica migrations pendentes em produção (`prisma migrate deploy`) |
| `npm run seed` | Cria/atualiza o operador inicial (idempotente; os dados de demonstração entram no B08) |
| `npm run demo:concorrencia -- --url <url>` | Demonstração ao vivo: N reservas simultâneas do mesmo assento (ver "Concorrência") |

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
| `VALIDACAO_ANTECEDENCIA_MINUTOS` | A partir de quantos minutos antes do início a entrada pode ser validada (padrão 60; vale até o fim do filme). Para uma demonstração com sessão futura, use um valor alto |
| `SEED_OPERADOR_NOME`, `SEED_OPERADOR_EMAIL`, `SEED_OPERADOR_SENHA` | Operador criado pelo `npm run seed` (lidas só pelo seed) |

### Testes e banco de teste

Os testes usam um banco separado, `bilheteria_test`, no mesmo container. O banco de desenvolvimento nunca é tocado.
- Antes da suíte, `tests/global-setup.ts` roda `prisma migrate deploy` nesse banco.
- Cada arquivo limpa as tabelas com `limparBanco()`, que se recusa a rodar se o banco não tiver "test" no nome.
- Para usar outro servidor (ex.: no CI), defina `TEST_DATABASE_URL`.

## Rotas da API

Autenticação: `Authorization: Bearer <token>` (obtido no login). Datas em ISO 8601 com fuso; valores em reais como número na entrada e string `"30.00"` na saída.

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/health` | público | Status da API e do banco |
| POST | `/auth/registrar` | público | Cadastro `{ nome, email, senha }`: sempre `CLIENTE` |
| POST | `/auth/login` | público | `{ email, senha }` → `{ token, usuario }` |
| GET | `/auth/me` | logado | Usuário do token |
| POST | `/usuarios/operadores` | OPERADOR | Cria outro operador `{ nome, email, senha }` |
| GET | `/filmes?ativo=&busca=` | público | Lista filmes |
| GET | `/filmes/:id` | público | Detalhe do filme |
| POST / PUT | `/filmes`, `/filmes/:id` | OPERADOR | Cria / substitui `{ titulo, sinopse, duracaoMinutos, classificacao, genero, posterUrl? }` |
| PATCH | `/filmes/:id/ativo` | OPERADOR | `{ ativo }`: ativa/desativa |
| DELETE | `/filmes/:id` | OPERADOR | Só sem sessões (senão 422 `FILME_COM_SESSOES`) |
| GET | `/salas`, `/salas/:id` | OPERADOR | Lista / detalhe com o layout de assentos |
| POST | `/salas` | OPERADOR | `{ nome, assentosPorFila, filas \| qtdFilas, assentosPcd?, assentosVip? }`: gera os assentos |
| PUT | `/salas/:id` | OPERADOR | `{ nome, ativa, estrutura? }`: estrutura bloqueada com sessões |
| GET | `/sessoes?filmeId=&salaId=&data=&incluirPassadas=&incluirCanceladas=` | público | Por padrão, só futuras e não canceladas |
| GET | `/sessoes/:id` | público | Detalhe com `assentosLivres` |
| GET | `/sessoes/:id/assentos` | público (login opcional) | Mapa: filas, status efetivo, `minhaReserva`, resumo |
| POST | `/sessoes` | OPERADOR | `{ filmeId, salaId, dataHora, preco }` |
| PATCH | `/sessoes/:id/cancelar` | OPERADOR | Só sem ingressos vendidos |
| POST | `/reservas` | CLIENTE/OPERADOR | `{ sessaoId, assentoIds }`: reserva temporária (`RESERVA_MINUTOS`) |
| GET | `/reservas/minhas` | logado | Reservas do usuário |
| GET | `/reservas/:id` | dono ou OPERADOR | Detalhe (404 para outros clientes) |
| DELETE | `/reservas/:id` | dono ou OPERADOR | Cancela uma reserva PENDENTE e libera os assentos |
| POST | `/reservas/:id/pagamento` | dono | `{ metodo: PIX \| CARTAO }` → `{ reserva, ingressos }` (pagamento simulado) |
| GET | `/ingressos/meus` | logado | Ingressos agrupados por sessão, com status `VALIDO` / `UTILIZADO` / `SESSAO_ENCERRADA` |
| GET | `/ingressos/:codigo` | dono ou OPERADOR | Detalhe do ingresso |
| POST | `/ingressos/validar` | OPERADOR | `{ codigo }`: validação na entrada (uso único) |
| POST | `/balcao/vendas` | OPERADOR | `{ sessaoId, assentoIds, metodo: DINHEIRO \| CARTAO \| PIX, nomeComprador? }`: reserva + pagamento |
| GET | `/relatorios/sessoes?inicio=&fim=&filmeId=&salaId=` | OPERADOR | Ocupação e receita por sessão (view) + totais com ocupação ponderada |
| GET | `/relatorios/vendas?inicio=&fim=&agrupar=dia\|filme\|metodo` | OPERADOR | Vendas e receita agrupadas, separadas por canal (APP × BALCÃO) |
| GET | `/relatorios/sessoes.csv?…` | OPERADOR | O relatório de sessões em CSV para o Excel pt-BR (`;`, decimal com vírgula) |

### Regras de negócio implementadas (services)

**Contas**
- O cadastro público nunca aceita `papel`: o body é estrito, e campos extras dão 400.
- O login responde sempre "E-mail ou senha inválidos.", com tempo constante.

**Salas (regra 8)**
- O service gera os assentos em uma transação.
- PCD/VIP precisam existir no layout.
- A estrutura não muda com sessões futuras (`SALA_COM_SESSOES_FUTURAS`) nem com histórico (`SALA_COM_HISTORICO`).

**Sessões (regra 7)**
- Precisam estar no futuro, com filme e sala ativos e uma sala com assentos.
- Não podem se sobrepor na mesma sala, considerando a duração do filme + 15 min de limpeza (`SESSAO_SOBREPOSTA`).
- A checagem e o INSERT rodam na mesma transação, com a sala travada por `SELECT ... FOR UPDATE`.
- Cancelar: na mesma transação, cancela as reservas pendentes e só então confere os ingressos. Se houver venda, `SESSAO_COM_INGRESSOS` e rollback.

**Reservas (regras 2, 3, 5 e 10)**
- Cada reserva tem de 1 a 10 assentos, sem repetidos e todos da sala da sessão (`ASSENTO_INVALIDO`).
- A sessão precisa estar no futuro e não cancelada.
- O total (quantidade × preço) e o prazo são sempre calculados no servidor.
- Um cliente só pode ter 1 reserva pendente por sessão (`RESERVA_PENDENTE_EXISTENTE`).
- Uma reserva vencida já aparece como livre no mapa e como `EXPIRADA` nas consultas, mesmo antes do job.
- O cliente cancela a própria reserva pendente.

**Pagamento (regra 4)**, em `pagamentoService`, tudo em uma transação:
1. trava a reserva (`SELECT ... FOR UPDATE`) e confere o dono, o status e o prazo;
2. cria o pagamento com valor = total da reserva;
3. muda os assentos de `RESERVADO` para `VENDIDO`, conferindo a contagem;
4. emite 1 ingresso por assento, com código de 10 caracteres sem `0/O/1/I` (`src/services/codigoIngresso.ts`);
5. marca a reserva como `PAGA`.

Casos especiais:
- **Dois pagamentos simultâneos:** o segundo espera o lock e recebe 409 `RESERVA_JA_PAGA`.
- **Reserva vencida:** a transação a marca `EXPIRADA` e libera os assentos. O 422 `RESERVA_EXPIRADA` só é lançado depois do COMMIT, para a expiração ficar gravada.
- **Fora de produção:** `simularFalha: true` lança um erro depois de emitir os ingressos, para demonstrar que o rollback desfaz tudo.

**Venda no balcão (regra 9):** `balcaoService.vender` chama, na **mesma transação**, os mesmos núcleos do app, `reservarNaTransacao` e `pagarNaTransacao`. Não há lógica de concorrência duplicada. Se um assento estiver ocupado, nada é cobrado.

**Validação na entrada (regra 6):** a ordem é:
1. código inexistente → 404 `INGRESSO_INVALIDO`;
2. já usado → 409 `INGRESSO_JA_UTILIZADO`, informando quando;
3. fora da janela → 422 `INGRESSO_FORA_DO_HORARIO`. A janela vai de `VALIDACAO_ANTECEDENCIA_MINUTOS` antes do início até o fim do filme;
4. o **UPDATE condicional** `SET utilizado_em = now() WHERE codigo = $c AND utilizado_em IS NULL`. Se duas validações chegam ao mesmo tempo, a segunda afeta 0 linhas e recebe 409.

## Concorrência

O ponto crítico é **dois clientes escolhendo o mesmo assento ao mesmo tempo**. Em `reservaService.reservar`, tudo acontece em **uma transação**:

1. `SELECT ... FROM sessao FOR SHARE`: a sessão é travada em modo compartilhado. Outras reservas seguem em paralelo, mas o cancelamento da sessão (`FOR UPDATE`) espera.
2. `INSERT` da reserva `PENDENTE`, com `expira_em` e `total` calculados no servidor.
3. `SELECT ... FROM sessao_assento ... ORDER BY assento_id FOR UPDATE`: as linhas dos assentos são travadas **sempre na mesma ordem**, o que evita deadlock entre pedidos com conjuntos cruzados.
4. O **UPDATE condicional atômico**:
   ```sql
   UPDATE sessao_assento SET status = 'RESERVADO', reserva_id = $r, reservado_ate = $t
    WHERE sessao_id = $s AND assento_id = ANY($ids)
      AND (status = 'LIVRE' OR (status = 'RESERVADO' AND reservado_ate < now()))
   ```
5. Se o número de linhas afetadas for diferente do número de assentos pedidos → `Conflito('ASSENTO_INDISPONIVEL')` (409) e **rollback**: nada fica gravado.

**Por que é seguro (READ COMMITTED):**
- A segunda transação concorrente **espera** o lock da linha que a primeira travou.
- Depois do COMMIT da primeira, o PostgreSQL **reavalia o WHERE** na versão nova da linha (agora `RESERVADO`, com prazo no futuro).
- A segunda afeta 0 linhas e recebe 409.
- Como segunda barreira, `UNIQUE(sessao_id, assento_id)` e `UNIQUE(sessao_assento_id)` em `ingresso` garantem no banco que um assento nunca é vendido duas vezes.
- Deadlock, conflito de serialização e timeout do pool viram 409/503 no errorHandler, nunca 500.

**Expiração:**
- O job `src/jobs/expirarReservas.ts` (node-cron, a cada minuto, desligado em `NODE_ENV=test`) chama `reservaService.expirarVencidas()` → `CALL sp_expirar_reservas()`.
- Ele não é a única defesa: o UPDATE acima já aceita assentos com reserva vencida.

**Provas:**
- `tests/concorrencia.test.ts`:
  - 20 reservas simultâneas do mesmo assento → exatamente 1 × 201 e 19 × 409, com 1 linha `RESERVADO` e 1 reserva no banco;
  - pares de assentos cruzados → sem deadlock;
  - os cenários de expiração.
- Demonstração ao vivo:
  ```bash
  npm run demo:concorrencia -- --url https://sua-api.exemplo.com --requisicoes 20
  ```
  - Usa o operador de `--email/--senha` (ou `DEMO_OPERADOR_EMAIL`/`DEMO_OPERADOR_SENHA`) e reaproveita (ou cria) a sessão "Demo Concorrência".
  - Imprime cada resposta e o veredito, e cancela a reserva vencedora no final.
  - Defina `DEMO_CLIENTE_SENHA` para reaproveitar os 2 clientes de demonstração. Sem ela, cada execução cria 2 clientes novos e faz mais chamadas em `/auth`, que tem limite de 20 por 15 minutos por IP.

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

Quem decide o que precisa ser atômico é o **service**; quem executa é o **repository**. O service chama `emTransacao(async (tx) => ...)` (`src/repositories/transacao.ts`) e repassa o cliente de transação (`tx`) como último argumento dos métodos do repository que participam da operação. Fora de uma transação, esse argumento é omitido e o repository usa o cliente padrão:

```ts
// service (decide e orquestra) – src/services/sala.service.ts
const salaId = await emTransacao(async (tx) => {
  const sala = await salaRepository.criar(nome, tx);
  await salaRepository.criarAssentos(sala.id, assentos, tx);
  return sala.id;
});

// repository (executa) – src/repositories/transacao.ts
export function emTransacao<T>(fn: (tx: ClienteBanco) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}
```

Quando a decisão depende do estado atual, o service trava a linha antes de decidir, com `SELECT ... FOR UPDATE` no repository. É o que acontece ao criar uma sessão (trava a sala) e ao cancelar uma sessão (trava a sessão).

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
