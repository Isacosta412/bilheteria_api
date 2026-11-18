-- =============================================================================
-- Migration manual: regras automatizadas no banco (BD II)
--   1. trigger trg_gerar_assentos_sessao  – gera o mapa de assentos de cada sessão
--   2. trigger trg_atualizado_em          – mantém a coluna atualizado_em
--   3. procedure sp_expirar_reservas()    – expira reservas vencidas e libera assentos
--   4. view vw_relatorio_sessoes          – ocupação e receita por sessão
--   5. índices extras
--
-- Divisão de responsabilidades: o SERVICE decide e orquestra (valida, chama a
-- procedure pelo job, lê a view e lança os erros de negócio). O BANCO automatiza o
-- que é mecânico e garante a integridade como defesa em profundidade.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TRIGGER trg_gerar_assentos_sessao
-- Ao inserir uma sessão, cria uma linha LIVRE em sessao_assento para cada assento
-- da sala. É essa linha que o UPDATE condicional da reserva trava e altera.
-- Se a sala não tem assentos, a exceção desfaz também o INSERT da sessão
-- (o trigger roda na mesma transação), impedindo uma sessão sem lugares.
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 2. TRIGGER trg_atualizado_em
-- Antes de qualquer UPDATE, grava o instante atual em atualizado_em.
-- O Prisma já faz isso nas operações dele (@updatedAt); o trigger cobre os UPDATEs
-- feitos em SQL puro, como os da procedure sp_expirar_reservas.
-- No PostgreSQL o nome do trigger é único por tabela, então usamos o mesmo nome
-- nas cinco tabelas que têm a coluna.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_atualizar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

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


-- -----------------------------------------------------------------------------
-- 3. STORED PROCEDURE sp_expirar_reservas
-- Em um único comando (CTEs que modificam dados, executadas atomicamente):
--   a) marca como EXPIRADA toda reserva PENDENTE cujo prazo (expira_em) já passou;
--   b) devolve para LIVRE os assentos que essas reservas ainda prendiam.
-- Parâmetro INOUT qtd_expiradas: devolve quantas reservas expiraram.
--
-- Uso:  CALL sp_expirar_reservas();         -- psql: mostra qtd_expiradas
--       $queryRaw`CALL sp_expirar_reservas(NULL)`  -- no repository (job do B05)
--
-- Concorrência:
--   * se uma reserva está sendo paga (SELECT ... FOR UPDATE no pagamento), o UPDATE
--     abaixo espera o lock e reavalia o WHERE: se ela virou PAGA, não é expirada;
--   * o filtro sa.reserva_id = e.id garante que um assento que outra reserva já
--     pegou depois do vencimento não é liberado por engano.
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 4. VIEW vw_relatorio_sessoes
-- Uma linha por sessão, juntando sessao, filme, sala, sessao_assento e ingresso.
--   capacidade    = assentos gerados para a sessão
--   vendidos      = assentos VENDIDO
--   reservados    = RESERVADO ainda dentro do prazo (reservado_ate >= now())
--   livres        = LIVRE + RESERVADO já vencido (que a procedure ainda não liberou):
--                   é o que um cliente consegue reservar neste momento
--   taxa_ocupacao = vendidos / capacidade × 100, numeric(5,2)
--   receita       = soma dos preços dos ingressos emitidos (ingresso × preco)
-- O LEFT JOIN com ingresso não duplica linhas: UNIQUE(sessao_assento_id) garante
-- no máximo um ingresso por assento da sessão.
-- filme_id, sala_id e cancelada estão na view para os filtros do relatório (B07).
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 5. ÍNDICES EXTRAS
-- Declarados também no schema.prisma (@@index com map) para o Prisma não tentar
-- removê-los numa próxima migration; o Prisma não compara a cláusula WHERE.
-- -----------------------------------------------------------------------------

-- Parcial: a procedure roda a cada minuto e só procura reservas PENDENTE vencidas.
-- O índice contém apenas as pendentes, então continua pequeno mesmo com milhares
-- de reservas pagas/expiradas no histórico.
CREATE INDEX "idx_reserva_pendente_expira_em"
  ON "reserva" ("expira_em")
  WHERE "status" = 'PENDENTE';

-- Parcial: o catálogo lista as próximas sessões (de todas as salas) por data.
-- O índice (sala_id, data_hora) só serve quando a sala é informada; sessões
-- canceladas nunca aparecem no catálogo, por isso ficam fora do índice.
CREATE INDEX "idx_sessao_data_hora_ativas"
  ON "sessao" ("data_hora")
  WHERE "cancelada" = false;

-- A FK reserva.sessao_id não tinha índice: acelera "reservas da sessão" e o
-- ON DELETE CASCADE de sessao → reserva (sem ele, cada exclusão varre a tabela).
CREATE INDEX "idx_reserva_sessao_id"
  ON "reserva" ("sessao_id");

-- Relatórios de receita por período (B07) filtram e agrupam por pago_em.
CREATE INDEX "idx_pagamento_pago_em"
  ON "pagamento" ("pago_em");
