# B03 – SQL: triggers, stored procedure, view e índices

```
Use o Plan Mode. Tarefa: criar uma migration SQL customizada (`npx prisma migrate dev --create-only --name sql_regras_banco`) e escrever à mão o SQL abaixo, em PostgreSQL, com comentários explicando cada objeto.

1. Função + TRIGGER trg_gerar_assentos_sessao
   AFTER INSERT ON sessao FOR EACH ROW → INSERT INTO sessao_assento (sessao_id, assento_id, status) SELECT NEW.id, a.id, 'LIVRE' FROM assento a WHERE a.sala_id = NEW.sala_id.
   Se a sala não tiver assentos, lance uma exceção (RAISE EXCEPTION) para impedir uma sessão sem lugares.

2. Função + TRIGGER trg_atualizado_em
   BEFORE UPDATE em usuario, filme, sala, sessao e reserva → NEW.atualizado_em = now().

3. STORED PROCEDURE sp_expirar_reservas()
   CREATE OR REPLACE PROCEDURE (não uma FUNCTION). Em um único bloco:
   - UPDATE reserva SET status = 'EXPIRADA' WHERE status = 'PENDENTE' AND expira_em < now() RETURNING id
   - para esses ids: UPDATE sessao_assento SET status = 'LIVRE', reserva_id = NULL, reservado_ate = NULL WHERE reserva_id IN (...) AND status = 'RESERVADO'
   Use uma CTE ou variável array. Ela deve poder ser chamada com `CALL sp_expirar_reservas();`.
   Bônus: um parâmetro INOUT qtd_expiradas INT que devolva quantas reservas expiraram.

4. VIEW vw_relatorio_sessoes (junta filme, sessao, sala, sessao_assento e ingresso/pagamento)
   Colunas: sessao_id, filme_titulo, sala_nome, data_hora, preco, capacidade, vendidos, reservados, livres, taxa_ocupacao (numeric 5,2, vendidos/capacidade*100), receita (soma dos preços dos ingressos vendidos).
   Use LEFT JOIN e COUNT(*) FILTER (WHERE ...).

5. Índices extras que o Prisma não criou, com comentário justificando cada um (ex.: índice parcial em reserva(expira_em) WHERE status = 'PENDENTE' para a procedure).

Depois:
- Aplique a migration e confira, com SQL direto (psql ou $queryRaw em um script), que: a trigger cria os sessao_assento ao inserir uma sessão; a procedure expira uma reserva vencida criada manualmente; a view retorna os dados corretos.
- Escreva o arquivo docs/sql.md explicando cada trigger, a procedure, a view e os índices, com o SQL e um exemplo de uso. Vou usar esse arquivo na apresentação de BD II.
```
