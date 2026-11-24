# CLAUDE.md – bilheteria-api (backend)

Você está desenvolvendo o **backend** do Trabalho Final de Programação II + Banco de Dados II (Unoesc): uma API de bilheteria com marcação de assentos para um cinema ou casa de eventos. O sistema será apresentado **rodando em produção**, então tudo precisa funcionar de verdade. Escreva código, mensagens de commit e documentação em **português do Brasil**. Identificadores de código podem ficar em português (ex.: `sessao`, `reserva`).

## Stack obrigatória (não substitua)
- TypeScript (strict), Node.js 20+, Express
- Prisma ORM + Prisma Migrate
- PostgreSQL (gerenciado em nuvem na produção)
- Comunicação somente via API REST com JSON
- Bibliotecas permitidas: `zod` (validação), `jsonwebtoken`, `bcryptjs`, `cors`, `helmet`, `express-rate-limit`, `node-cron`, `nanoid` ou `crypto.randomUUID`, `dotenv`. Testes: `vitest` + `supertest`. Peça antes de adicionar qualquer outra dependência.

## Arquitetura em camadas (critério de avaliação, siga à risca)
```
src/
  config/          env tipado (zod), prisma client singleton
  routes/          só define rotas e aplica middlewares
  controllers/     lê req, chama o service, devolve res. SEM regra de negócio, SEM Prisma
  services/        TODA a regra de negócio e validação. Usa repositories. Lança AppError
  repositories/    ÚNICO lugar que usa o Prisma Client ($transaction, $queryRaw, etc.)
  schemas/         schemas zod dos DTOs de entrada
  middlewares/     auth (JWT), autorização por papel, validação zod, tratamento de erros
  jobs/            agendamentos (expiração de reservas) que chamam services
  errors/          AppError e subclasses (NaoEncontrado, Conflito, RegraNegocio, NaoAutorizado)
  types/           tipos e DTOs de saída
  app.ts, server.ts
prisma/
  schema.prisma
  migrations/      inclui migrations SQL customizadas (trigger, procedure, view, índices)
  seed.ts
tests/
```
Regras:
- Controller nunca importa `prisma`. Service nunca importa `prisma` diretamente: recebe ou usa repositories. Repository não contém `if` de regra de negócio (só consulta e persiste).
- Transações: o **service** decide o que é atômico e chama um método de repository que recebe um cliente de transação (`Prisma.TransactionClient`), ou chama `repository.emTransacao(async (tx) => ...)`. Documente esse padrão no README.
- Tudo tipado: nada de `any`. DTOs de entrada vêm dos schemas zod (`z.infer`); DTOs de saída são tipos explícitos.
- Respostas de erro no formato `{ "erro": { "codigo": "ASSENTO_INDISPONIVEL", "mensagem": "..." } }`, com status HTTP coerente (400, 401, 403, 404, 409, 422).
- Nunca devolva `senhaHash` nem outros dados sensíveis. Nunca aceite do cliente campos controlados pelo sistema (ids gerados, `total`, `status`, `codigo` do ingresso, `usuarioId` do token).

## Domínio e regras de negócio
Perfis: `CLIENTE` e `OPERADOR`. O operador faz o papel de Bilheteria e de Gerência.

Entidades: `Usuario`, `Filme` (filme ou evento), `Sala`, `Assento` (fila + número, fixos por sala), `Sessao` (filme, sala, dataHora, preco), `SessaoAssento` (status do assento naquela sessão), `Reserva`, `Pagamento`, `Ingresso`.

Regras (todas implementadas e testadas no service):
1. **Um assento de uma sessão só pode ser vendido uma vez.** Garantido no service pelo UPDATE condicional atômico e, no banco, por `UNIQUE(sessao_id, assento_id)` em `sessao_assento` e `UNIQUE(sessao_assento_id)` em `ingresso`.
2. **Reserva temporária com expiração**: ao reservar, os assentos ficam `RESERVADO` com `reservado_ate = agora + RESERVA_MINUTOS` (env, padrão 10). Se o pagamento não ocorrer no prazo, a reserva vira `EXPIRADA` e os assentos voltam a `LIVRE`.
3. **Concorrência**: reservar usa, dentro de uma transação, um UPDATE único:
   `UPDATE sessao_assento SET status='RESERVADO', reserva_id=$r, reservado_ate=$t WHERE sessao_id=$s AND assento_id = ANY($ids) AND (status='LIVRE' OR (status='RESERVADO' AND reservado_ate < now()))`.
   Se o número de linhas afetadas for diferente do número de assentos pedidos, faça rollback e lance `Conflito('ASSENTO_INDISPONIVEL')`. Nunca faça "ler, conferir em JS e depois gravar" sem lock.
4. **Pagamento (simulado)**: só para reserva `PENDENTE`, não expirada e do próprio usuário (ou feita por operador). Em uma transação: trava a reserva (`SELECT ... FOR UPDATE`), confere a expiração, cria o `Pagamento`, muda os assentos para `VENDIDO`, emite um `Ingresso` por assento com `codigo` único e não sequencial (ex.: `nanoid(10)` em maiúsculas) e marca a reserva como `PAGA`.
5. **Total calculado no servidor**: `inteiras × sessao.preco + meias × precoMeia` (meia = metade, arredondada para centavos; `reserva.qtd_meia`). Preço em `Decimal(10,2)`. Cada ingresso guarda `tipo` (INTEIRA/MEIA) e `valor`.
6. **Validação na entrada**: o operador informa o código e o service marca `utilizado_em = now()` com UPDATE condicional (`WHERE utilizado_em IS NULL`). Código inexistente → 404; já usado → 409 informando quando foi usado. Opcional: recusar ingresso de sessão que já terminou ou de outro dia.
7. **Sessões**: não permitir duas sessões na mesma sala com horários sobrepostos (use `filme.duracao_minutos` + intervalo de limpeza). Não permitir criar sessão no passado. Não permitir excluir sessão que tenha ingressos vendidos.
8. **Salas e assentos**: o operador cria a sala informando filas (ex.: A–J) e assentos por fila; o service gera os assentos. Não permitir alterar a estrutura de uma sala que já tenha sessões futuras.
9. **Venda no balcão**: o operador reserva e paga em uma única operação (método `DINHEIRO`, `CARTAO` ou `PIX`), com os mesmos controles de concorrência.
10. **Cancelamento**: o cliente pode cancelar a própria reserva `PENDENTE`, e os assentos voltam a `LIVRE`.

## Banco de dados (critérios de BD II)
- Nomes de tabelas e colunas em snake_case (`@@map`, `@map`); models Prisma em PascalCase.
- PKs, FKs com `onDelete` explícito, `UNIQUE` e `CHECK` onde fizer sentido (preco > 0, numero > 0, `reservado_ate` obrigatório quando status = RESERVADO).
- Índices: `sessao(sala_id, data_hora)`, `sessao(filme_id)`, `sessao_assento(sessao_id, status)`, `reserva(usuario_id)`, `reserva(status, expira_em)`, `ingresso(codigo)` UNIQUE.
- SQL customizado vai em migrations criadas com `npx prisma migrate dev --create-only`, editadas à mão:
  - **Trigger** `trg_gerar_assentos_sessao` (AFTER INSERT ON sessao): insere em `sessao_assento` uma linha `LIVRE` para cada assento da sala.
  - **Trigger** `trg_atualizado_em` (BEFORE UPDATE): mantém a coluna `atualizado_em`.
  - **Stored procedure** `sp_expirar_reservas()` (CREATE PROCEDURE, chamada com `CALL`): marca como `EXPIRADA` as reservas `PENDENTE` vencidas e libera os assentos delas.
  - **View** `vw_relatorio_sessoes`: por sessão, filme, sala, data/hora, capacidade, vendidos, reservados, taxa de ocupação (%) e receita.
- Nunca edite uma migration já aplicada. Crie uma nova.

## Convenções
- Variáveis de ambiente validadas com zod em `src/config/env.ts`: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `RESERVA_MINUTOS`, `CORS_ORIGIN`, `PORT`.
- Mantenha `.env.example` atualizado e `.env` no `.gitignore`.
- Scripts npm: `dev`, `build`, `start`, `test`, `prisma:migrate`, `prisma:deploy`, `seed`.
- Depois de cada etapa: rode `npm run build` e `npm test` e corrija os erros antes de dizer que terminou.
- Ao terminar uma tarefa, responda com: o que foi feito, os arquivos alterados, como testar e as pendências.
