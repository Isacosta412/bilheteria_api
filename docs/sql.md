# SQL do banco – triggers, procedure, view e índices

Material de apoio para a apresentação de **Banco de Dados II**.
Todo o SQL abaixo está na migration [`prisma/migrations/20261118001337_sql_regras_banco/migration.sql`](../prisma/migrations/20261118001337_sql_regras_banco/migration.sql), criada com `npx prisma migrate dev --create-only` e escrita à mão. As CHECK constraints estão na migration anterior, `constraints_check` (ver [der.md](der.md)).

## Quem faz o quê: service × banco

| Camada | Papel | Exemplos |
|---|---|---|
| **Service** (TypeScript) | **Decide e orquestra**: valida a entrada, aplica as regras de negócio, escolhe o que é atômico e devolve erros claros (409, 422...). | Reservar com UPDATE condicional, pagar com `SELECT ... FOR UPDATE`, chamar a procedure pelo job, ler a view no relatório. |
| **Banco** (PostgreSQL) | **Garante a integridade** e automatiza o que é mecânico, mesmo se alguém executar SQL direto. | UNIQUE, CHECK e FKs; trigger que gera os assentos; trigger de `atualizado_em`; procedure de expiração; view de relatório. |

Os dois se complementam: o service checa antes, para dar uma mensagem amigável, e o banco recusa qualquer estado inválido que escape (defesa em profundidade).

---

## 1. Trigger `trg_gerar_assentos_sessao`

**O que faz:** ao inserir uma sessão, cria em `sessao_assento` uma linha `LIVRE` para cada assento da sala. Se a sala não tem assentos, lança uma exceção e **a sessão também não é criada**: o trigger roda na mesma transação do INSERT.

**Por que existe:** o mapa de assentos de uma sessão precisa existir antes de qualquer reserva, porque é essa linha que o UPDATE condicional da reserva trava e altera. Gerar no banco garante que **nenhuma sessão fica sem mapa**, seja ela criada pela API, por um script ou pelo psql.

```sql
CREATE OR REPLACE FUNCTION fn_gerar_assentos_sessao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  qtd_assentos INTEGER;
BEGIN
  INSERT INTO sessao_assento (sessao_id, assento_id, status)
  SELECT NEW.id, a.id, 'LIVRE'
  FROM assento a
  WHERE a.sala_id = NEW.sala_id;

  GET DIAGNOSTICS qtd_assentos = ROW_COUNT;

  IF qtd_assentos = 0 THEN
    RAISE EXCEPTION 'SALA_SEM_ASSENTOS: a sala % não possui assentos cadastrados', NEW.sala_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL; -- o retorno de um trigger AFTER é ignorado
END;
$$;

CREATE TRIGGER trg_gerar_assentos_sessao
AFTER INSERT ON sessao
FOR EACH ROW
EXECUTE FUNCTION fn_gerar_assentos_sessao();
```

**Por que AFTER e não BEFORE:** no AFTER, a linha da sessão já existe e tem `id`, então a FK `sessao_assento.sessao_id → sessao.id` é satisfeita.

**Exemplo** (sala com filas A e B, 5 assentos cada):
```sql
INSERT INTO sessao (filme_id, sala_id, data_hora, preco)
VALUES (1, 1, now() + interval '1 day', 30);

SELECT status, count(*) FROM sessao_assento GROUP BY status;
--  status | count
-- --------+-------
--  LIVRE  |    10

INSERT INTO sessao (filme_id, sala_id, data_hora, preco)
VALUES (1, 2, now() + interval '1 day', 30);   -- sala 2 não tem assentos
-- ERROR:  SALA_SEM_ASSENTOS: a sala 2 não possui assentos cadastrados
```

---

## 2. Trigger `trg_atualizado_em`

**O que faz:** antes de qualquer UPDATE em `usuario`, `filme`, `sala`, `sessao` e `reserva`, grava `now()` em `atualizado_em`.

**Por que existe:** o Prisma já atualiza a coluna nas operações dele (`@updatedAt`), mas os UPDATEs feitos em SQL puro passariam despercebidos, como o da procedure de expiração. Com o trigger, a coluna é confiável sempre.

```sql
CREATE OR REPLACE FUNCTION fn_atualizar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

-- Uma única função, reaproveitada por cinco triggers.
-- No PostgreSQL o nome do trigger é único por tabela, então o mesmo nome serve nas cinco.
CREATE TRIGGER trg_atualizado_em BEFORE UPDATE ON usuario
FOR EACH ROW EXECUTE FUNCTION fn_atualizar_atualizado_em();
CREATE TRIGGER trg_atualizado_em BEFORE UPDATE ON filme
FOR EACH ROW EXECUTE FUNCTION fn_atualizar_atualizado_em();
CREATE TRIGGER trg_atualizado_em BEFORE UPDATE ON sala
FOR EACH ROW EXECUTE FUNCTION fn_atualizar_atualizado_em();
CREATE TRIGGER trg_atualizado_em BEFORE UPDATE ON sessao
FOR EACH ROW EXECUTE FUNCTION fn_atualizar_atualizado_em();
CREATE TRIGGER trg_atualizado_em BEFORE UPDATE ON reserva
FOR EACH ROW EXECUTE FUNCTION fn_atualizar_atualizado_em();
```

**Por que BEFORE:** é o único momento em que dá para alterar `NEW` antes de gravar.

**Exemplo:**
```sql
UPDATE sala SET ativa = false WHERE id = 1;
SELECT criado_em, atualizado_em FROM sala WHERE id = 1;
-- atualizado_em passa a ser o instante do UPDATE; criado_em não muda
```

---

## 3. Stored procedure `sp_expirar_reservas`

**O que faz:** em um único comando,
1. marca como `EXPIRADA` toda reserva `PENDENTE` cujo `expira_em` já passou;
2. devolve para `LIVRE` os assentos que essas reservas ainda prendiam;
3. devolve em `qtd_expiradas` quantas reservas expiraram.

**Por que existe:** implementa a regra 2 do sistema (reserva temporária com expiração). O **job do service** (`node-cron`, etapa B05) chama a procedure a cada minuto e registra o resultado no log. A decisão de *quando* expirar é do service; a procedure garante que reserva e assentos mudam **juntos**.

```sql
CREATE OR REPLACE PROCEDURE sp_expirar_reservas(INOUT qtd_expiradas INTEGER DEFAULT 0)
LANGUAGE plpgsql
AS $$
BEGIN
  WITH expiradas AS (
    UPDATE reserva
       SET status = 'EXPIRADA'
     WHERE status = 'PENDENTE'
       AND expira_em < now()
    RETURNING id
  ),
  liberados AS (
    UPDATE sessao_assento sa
       SET status = 'LIVRE',
           reserva_id = NULL,
           reservado_ate = NULL
      FROM expiradas e
     WHERE sa.reserva_id = e.id
       AND sa.status = 'RESERVADO'
    RETURNING sa.id
  )
  SELECT count(*)::INTEGER INTO qtd_expiradas FROM expiradas;
END;
$$;
```

**Pontos para explicar:**
- **PROCEDURE, não FUNCTION:** é chamada com `CALL`, não faz parte de um `SELECT` e representa uma *ação*. O parâmetro `INOUT` é a forma de uma procedure devolver um valor.
- **CTEs que modificam dados** (`WITH ... UPDATE ... RETURNING`): os dois UPDATEs fazem parte do **mesmo comando**, então são atômicos. Os ids expirados passam de um para o outro sem tabela temporária. O PostgreSQL executa toda CTE de escrita, mesmo que a consulta final só leia `expiradas`.
- **Concorrência com o pagamento:** o pagamento trava a reserva com `SELECT ... FOR UPDATE`. Se a procedure tentar expirar essa mesma reserva, o `UPDATE` **espera o lock** e, depois, reavalia o `WHERE status = 'PENDENTE'`. Se a reserva foi paga, ela não é expirada.
- **Concorrência com outra reserva:** um assento vencido pode ser pego por outra reserva antes de a procedure rodar (o UPDATE da reserva aceita `RESERVADO AND reservado_ate < now()`). O filtro `sa.reserva_id = e.id` garante que a procedure só libera assentos que **ainda pertencem** à reserva expirada.

**Exemplo** (uma reserva vencida com 2 assentos, uma válida com 1 e uma paga com 2):
```sql
CALL sp_expirar_reservas();
--  qtd_expiradas
-- ---------------
--              1

SELECT id, status FROM reserva ORDER BY id;
--  id |  status
-- ----+----------
--   1 | EXPIRADA
--   2 | PENDENTE
--   3 | PAGA

SELECT status, count(*) FROM sessao_assento GROUP BY status ORDER BY status;
--   status   | count
-- -----------+-------
--  LIVRE     |     7
--  RESERVADO |     1
--  VENDIDO   |     2

CALL sp_expirar_reservas();   -- de novo: nada mais para expirar
--  qtd_expiradas
-- ---------------
--              0
```

**No código** (repository, chamado pelo service do job):
```ts
const [{ qtd_expiradas }] = await prisma.$queryRaw<{ qtd_expiradas: number }[]>`CALL sp_expirar_reservas(NULL)`;
```

---

## 4. View `vw_relatorio_sessoes`

**O que faz:** uma linha por sessão com filme, sala, data/hora, preço, capacidade, vendidos, reservados, livres, taxa de ocupação e receita.

**Por que existe:** é o relatório gerencial do operador (etapa B07). Junta **cinco tabelas** (sessao, filme, sala, sessao_assento, ingresso) e esconde essa complexidade atrás de um `SELECT * FROM vw_relatorio_sessoes`. O repository a consulta com `$queryRaw` tipado.

```sql
CREATE OR REPLACE VIEW vw_relatorio_sessoes AS
SELECT
  se.id                                                         AS sessao_id,
  f.id                                                          AS filme_id,
  f.titulo                                                      AS filme_titulo,
  sa_sala.id                                                    AS sala_id,
  sa_sala.nome                                                  AS sala_nome,
  se.data_hora                                                  AS data_hora,
  se.preco                                                      AS preco,
  se.cancelada                                                  AS cancelada,
  COUNT(sa.id)::INTEGER                                         AS capacidade,
  (COUNT(*) FILTER (WHERE sa.status = 'VENDIDO'))::INTEGER      AS vendidos,
  (COUNT(*) FILTER (
     WHERE sa.status = 'RESERVADO' AND sa.reservado_ate >= now()
  ))::INTEGER                                                   AS reservados,
  (COUNT(*) FILTER (
     WHERE sa.status = 'LIVRE'
        OR (sa.status = 'RESERVADO' AND sa.reservado_ate < now())
  ))::INTEGER                                                   AS livres,
  COALESCE(
    ROUND(
      (COUNT(*) FILTER (WHERE sa.status = 'VENDIDO')) * 100.0
        / NULLIF(COUNT(sa.id), 0),
      2),
    0)::NUMERIC(5, 2)                                           AS taxa_ocupacao,
  (COUNT(i.id) * se.preco)::NUMERIC(12, 2)                      AS receita
FROM sessao se
JOIN filme f            ON f.id = se.filme_id
JOIN sala sa_sala       ON sa_sala.id = se.sala_id
LEFT JOIN sessao_assento sa ON sa.sessao_id = se.id
LEFT JOIN ingresso i        ON i.sessao_assento_id = sa.id
GROUP BY se.id, f.id, f.titulo, sa_sala.id, sa_sala.nome;
```

**Pontos para explicar:**
- **`COUNT(*) FILTER (WHERE ...)`:** conta vendidos, reservados e livres numa única passada pelas linhas, sem subconsultas.
- **`LEFT JOIN`:** uma sessão aparece no relatório mesmo sem nenhum ingresso (receita 0, taxa 0).
- **O JOIN com ingresso não duplica linhas:** `UNIQUE(sessao_assento_id)` garante no máximo um ingresso por assento da sessão. Por isso `COUNT(i.id) × preco` é exatamente a soma dos preços dos ingressos vendidos.
- **`NULLIF(capacidade, 0)`** evita divisão por zero, e `COALESCE(..., 0)` devolve 0% nesse caso.
- **Reservados "efetivos":** um assento `RESERVADO` com prazo vencido, que a procedure ainda não liberou, conta como **livre**. É o que um cliente realmente consegue reservar naquele momento.
- **`GROUP BY se.id, ...`:** como `se.id` é a PK, o PostgreSQL aceita `se.data_hora`, `se.preco` e `se.cancelada` no SELECT sem listá-los (dependência funcional).
- `filme_id`, `sala_id` e `cancelada` vão na view para os filtros do relatório (por filme, por sala, por período).

**Exemplo** (10 lugares: 2 vendidos, 1 reservado válido, 1 reservado vencido, preço R$ 30):
```sql
SELECT sessao_id, filme_titulo, sala_nome, preco, capacidade, vendidos,
       reservados, livres, taxa_ocupacao, receita
FROM vw_relatorio_sessoes;
--  sessao_id | filme_titulo | sala_nome | preco | capacidade | vendidos | reservados | livres | taxa_ocupacao | receita
-- -----------+--------------+-----------+-------+------------+----------+------------+--------+---------------+---------
--          1 | Duna 3       | Sala Demo | 30.00 |         10 |        2 |          1 |      7 |         20.00 |   60.00

-- Relatório de um período, ordenado pela ocupação:
SELECT filme_titulo, sala_nome, data_hora, taxa_ocupacao, receita
FROM vw_relatorio_sessoes
WHERE NOT cancelada AND data_hora BETWEEN '2026-11-24' AND '2026-11-30'
ORDER BY taxa_ocupacao DESC;
```

---

## 5. Índices

### Índices criados pelo Prisma (schema.prisma)
| Índice | Para quê |
|---|---|
| `sessao(sala_id, data_hora)` | Checar sobreposição de horários na mesma sala (regra 7) e listar as sessões de uma sala. |
| `sessao(filme_id)` | Sessões de um filme. |
| `sessao_assento(sessao_id, status)` | Mapa de assentos e contagem por status. |
| `sessao_assento(reserva_id)` | Assentos de uma reserva (pagamento, cancelamento, procedure). |
| `reserva(status, expira_em)`, `reserva(usuario_id)` | Filtrar por status e "minhas reservas". |
| `ingresso(reserva_id)` | Ingressos de uma reserva. |
| UNIQUE: `sessao_assento(sessao_id, assento_id)`, `ingresso(sessao_assento_id)`, `ingresso(codigo)`, `assento(sala_id, fila, numero)`, `usuario(email)`, `sala(nome)`, `pagamento(reserva_id)` | Integridade, e também aceleram as buscas por essas colunas. |

### Índices extras (migration `sql_regras_banco`)
```sql
-- Parcial: a procedure roda a cada minuto e só procura reservas PENDENTE vencidas.
CREATE INDEX "idx_reserva_pendente_expira_em"
  ON "reserva" ("expira_em")
  WHERE "status" = 'PENDENTE';

-- Parcial: o catálogo lista as próximas sessões (de todas as salas) por data.
CREATE INDEX "idx_sessao_data_hora_ativas"
  ON "sessao" ("data_hora")
  WHERE "cancelada" = false;

-- FK sem índice: "reservas da sessão" e o ON DELETE CASCADE de sessao → reserva.
CREATE INDEX "idx_reserva_sessao_id" ON "reserva" ("sessao_id");

-- Relatórios de receita por período.
CREATE INDEX "idx_pagamento_pago_em" ON "pagamento" ("pago_em");
```

| Índice | Justificativa |
|---|---|
| `idx_reserva_pendente_expira_em` (**parcial**) | Contém só as reservas pendentes, que são poucas a cada momento. A procedure faz `WHERE status = 'PENDENTE' AND expira_em < now()`, exatamente o que o índice cobre, e ele continua pequeno mesmo com milhares de reservas pagas ou expiradas no histórico. |
| `idx_sessao_data_hora_ativas` (**parcial**) | O índice `(sala_id, data_hora)` só ajuda quando a sala é informada. O catálogo busca "próximas sessões" de todas as salas por data, e as canceladas nunca aparecem nele. |
| `idx_reserva_sessao_id` | O PostgreSQL **não cria índice automático em FKs**. Sem ele, cada `DELETE` de sessão (cascade para reserva) e cada "reservas da sessão" varreria a tabela inteira. |
| `idx_pagamento_pago_em` | Filtros e agrupamentos por data de pagamento no relatório de receita. |

**Detalhe técnico do Prisma:** os índices comuns também estão declarados no `schema.prisma` (`@@index(..., map: "idx_...")`), senão o Prisma tentaria removê-los numa próxima migration. Os **parciais** existem **só** na migration: o Prisma 6 ignora índices parciais quando lê o banco, então declará-los no schema faria o Prisma tentar recriá-los. A conferência é `npx prisma migrate diff ... --exit-code`, que deve responder "No difference detected".

Para ver os índices no banco:
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE indexname LIKE 'idx_%' ORDER BY 1;
```

---

## 6. Relatório gerencial

São três rotas, todas **só para OPERADOR**. O SQL fica em `src/repositories/relatorio.repository.ts` e as regras (período e totais) em `src/services/relatorio.service.ts`. Todas as consultas usam `$queryRaw` com `Prisma.sql`, então **nenhum valor do usuário é concatenado no SQL**.

| Rota | Consulta | Tabelas envolvidas |
|---|---|---|
| `GET /relatorios/sessoes` | view `vw_relatorio_sessoes` | sessao, filme, sala, sessao_assento, ingresso (5, pela view) |
| `GET /relatorios/vendas` | CTE `vendas` + `GROUP BY` | pagamento, reserva, sessao, filme, ingresso (5) |
| `GET /relatorios/sessoes.csv` | a mesma do `/sessoes` | mesmas da view |

O período (`inicio`/`fim`, AAAA-MM-DD, os dois inclusive) é interpretado em dias de Brasília. Ele vira o intervalo `[inicio 00:00-03:00, fim+1 00:00-03:00)`. Sem datas, o padrão é de 30 dias atrás até 30 dias à frente. O service recusa `inicio > fim` (422 `PERIODO_INVALIDO`) e períodos maiores que 1 ano (422 `PERIODO_MUITO_LONGO`).

### 6.1 Ocupação e receita por sessão (view)

```sql
SELECT sessao_id, filme_id, filme_titulo, sala_id, sala_nome, data_hora, preco, cancelada,
       capacidade, vendidos, reservados, livres, taxa_ocupacao, receita
  FROM vw_relatorio_sessoes
 WHERE data_hora >= $1 AND data_hora < $2
   AND NOT cancelada
   AND filme_id = $3      -- só se ?filmeId vier (fragmento Prisma.sql; senão Prisma.empty)
   AND sala_id  = $4      -- só se ?salaId vier
 ORDER BY data_hora, sala_nome;
```

**Exemplo de saída.** É o cenário do teste `tests/relatorios.test.ts`: duas salas de 10 lugares e ingresso a R$ 25,00. Na primeira sessão, 3 ingressos foram comprados pelo app e 2 assentos estão reservados. Na segunda, 2 foram vendidos no balcão.

| filme_titulo | sala_nome | preco | capacidade | vendidos | reservados | livres | taxa_ocupacao | receita |
|---|---|---|---|---|---|---|---|---|
| Filme Um | Sala 4 | 25.00 | 10 | 3 | 2 | 5 | **30.00** | **75.00** |
| Ação; Parte "2" | Sala 5 | 25.00 | 10 | 2 | 0 | 8 | 20.00 | 50.00 |

**Totais (calculados no service):**
- `quantidadeSessoes` 2, `capacidadeTotal` 20, `ingressosVendidos` 5, `assentosReservados` 2 e `receitaTotal` "125.00".
- `ocupacaoMediaPonderada` "25.00" = (3 + 2) ÷ (10 + 10) × 100. A média é **ponderada pela capacidade**: numa sala de 200 lugares com 50% e numa de 20 com 100%, a média simples daria 75%, mas a ocupação real é 54,5% (120 de 220 lugares).

**Conversões:**
- A view já devolve as contagens como `INTEGER` (nunca `bigint`).
- `preco`, `taxa_ocupacao` e `receita` vêm como `numeric`, que o Prisma entrega como `Decimal`. O service os converte em string com 2 casas ("30.00") e soma os totais com `Decimal`, sem ponto flutuante.

### 6.2 Vendas agrupadas (pagamento + reserva + sessao + filme + ingresso)

```sql
WITH vendas AS (
  SELECT p.metodo, p.valor, p.pago_em, r.canal,
         f.id AS filme_id, f.titulo AS filme_titulo,
         (SELECT count(*) FROM ingresso i WHERE i.reserva_id = r.id)::int AS ingressos
    FROM pagamento p
    JOIN reserva r ON r.id = p.reserva_id
    JOIN sessao  s ON s.id = r.sessao_id
    JOIN filme   f ON f.id = s.filme_id
   WHERE p.pago_em >= $1 AND p.pago_em < $2          -- período pela DATA DA VENDA
)
SELECT <chave> AS chave, <rotulo> AS rotulo,
       count(*)::int                                                     AS vendas,
       sum(ingressos)::int                                               AS ingressos,
       sum(valor)                                                        AS receita,
       coalesce(sum(ingressos) FILTER (WHERE canal = 'APP'), 0)::int     AS ingressos_app,
       coalesce(sum(valor)     FILTER (WHERE canal = 'APP'), 0)          AS receita_app,
       coalesce(sum(ingressos) FILTER (WHERE canal = 'BALCAO'), 0)::int  AS ingressos_balcao,
       coalesce(sum(valor)     FILTER (WHERE canal = 'BALCAO'), 0)       AS receita_balcao
  FROM vendas
 GROUP BY <grupo>
 ORDER BY <ordem>;
```

`?agrupar=` escolhe um entre **três fragmentos fixos** do código. O texto do usuário nunca entra no SQL: o zod só aceita `dia`, `filme` ou `metodo`.

| agrupar | chave / rótulo | ordem |
|---|---|---|
| `dia` (padrão) | `to_char(pago_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')` / `DD/MM/YYYY` | por data |
| `filme` | `filme_id` / `filme_titulo` | receita, da maior para a menor |
| `metodo` | `metodo` | receita, da maior para a menor |

**Pontos para explicar:**
- **CTE (`WITH vendas AS`):** monta uma vez a "linha de venda" com os dados das 4 tabelas, e o `SELECT` de fora só agrega. O mesmo SQL serve aos três agrupamentos.
- **Subconsulta correlacionada:** conta os ingressos **de cada venda** sem multiplicar as linhas do pagamento. Um `JOIN ingresso` direto repetiria o `valor` uma vez por ingresso e inflaria a receita.
- **`FILTER (WHERE canal = ...)`:** separa APP e BALCÃO na mesma passada.
- **`AT TIME ZONE 'America/Sao_Paulo'`:** uma venda às 22h em Brasília (01h UTC do dia seguinte) conta no dia certo.

**Exemplo de saída** (mesmo cenário, `?agrupar=metodo`):

| chave | vendas | ingressos | receita | ingressos_app | receita_app | ingressos_balcao | receita_balcao |
|---|---|---|---|---|---|---|---|
| PIX | 1 | 3 | 75.00 | 3 | 75.00 | 0 | 0 |
| DINHEIRO | 1 | 2 | 50.00 | 0 | 0 | 2 | 50.00 |

**Resposta da API:**
```json
{
  "periodo": { "inicio": "2026-10-20", "fim": "2026-12-19" },
  "agrupamento": "metodo",
  "totais": { "vendas": 2, "ingressos": 5, "receita": "125.00",
              "app": { "ingressos": 3, "receita": "75.00" }, "balcao": { "ingressos": 2, "receita": "50.00" } },
  "grupos": [
    { "chave": "PIX", "rotulo": "PIX", "vendas": 1, "ingressos": 3, "receita": "75.00",
      "app": { "ingressos": 3, "receita": "75.00" }, "balcao": { "ingressos": 0, "receita": "0.00" } },
    { "chave": "DINHEIRO", "rotulo": "DINHEIRO", "vendas": 1, "ingressos": 2, "receita": "50.00",
      "app": { "ingressos": 0, "receita": "0.00" }, "balcao": { "ingressos": 2, "receita": "50.00" } }
  ]
}
```

### 6.3 Exportação CSV (`/relatorios/sessoes.csv`)

Usa os mesmos filtros e a mesma consulta da 6.1, no formato que o **Excel em português** abre com duplo clique:
- BOM UTF-8, para os acentos aparecerem certos;
- separador `;`;
- decimal com vírgula;
- data/hora em Brasília;
- campos com `;` ou `"` entre aspas, com as aspas duplicadas;
- uma linha TOTAL no fim.

```
Data/hora;Filme;Sala;Preço (R$);Capacidade;Vendidos;Reservados;Livres;Ocupação (%);Receita (R$)
20/11/2026 19:18;Filme Um;Sala 4;25,00;10;3;2;5;30,00;75,00
21/11/2026 19:18;"Ação; Parte ""2""";Sala 5;25,00;10;2;0;8;20,00;50,00

TOTAL;2 sessão(ões);;;20;5;2;;25,00;125,00
```

---

## Como conferir

- **Testes automatizados:** `tests/sql-banco.test.ts` cobre a trigger (com e sem assentos), o `atualizado_em`, a procedure e os números da view. Cada teste roda numa transação desfeita no fim, então o banco fica limpo:
  ```bash
  npm test
  ```
- **No psql do container:**
  ```bash
  docker exec -it bilheteria-postgres psql -U bilheteria -d bilheteria
  ```
  Comandos úteis: `\df` (funções e procedures), `\dv` (views), `\d sessao` (colunas, índices e triggers da tabela).
