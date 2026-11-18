# B02 – Modelagem no Prisma (schema + primeira migration)

```
Use o Plan Mode. Tarefa: modelar o banco no prisma/schema.prisma, seguindo o CLAUDE.md (seções "Domínio" e "Banco de dados").

Models e campos mínimos (pode melhorar, mas justifique):
- Usuario: id, nome, email (unique), senhaHash, papel (enum Papel: CLIENTE, OPERADOR), criadoEm, atualizadoEm
- Filme: id, titulo, sinopse, duracaoMinutos, classificacao (enum: LIVRE, DEZ, DOZE, CATORZE, DEZESSEIS, DEZOITO), genero, posterUrl (opcional), ativo, criadoEm, atualizadoEm
- Sala: id, nome (unique), ativa, criadoEm, atualizadoEm
- Assento: id, salaId, fila (char 1–2), numero (int), tipo (enum: PADRAO, PCD, VIP; opcional)  → @@unique([salaId, fila, numero])
- Sessao: id, filmeId, salaId, dataHora (timestamptz), preco (Decimal 10,2), cancelada (bool), criadoEm, atualizadoEm
- SessaoAssento: id, sessaoId, assentoId, status (enum StatusAssento: LIVRE, RESERVADO, VENDIDO), reservaId (opcional), reservadoAte (opcional)  → @@unique([sessaoId, assentoId]), @@index([sessaoId, status])
- Reserva: id, usuarioId (quem é o dono; na venda de balcão é o operador), sessaoId, status (enum StatusReserva: PENDENTE, PAGA, EXPIRADA, CANCELADA), canal (enum: APP, BALCAO), total (Decimal), expiraEm, criadoEm, atualizadoEm  → @@index([status, expiraEm]), @@index([usuarioId])
- Pagamento: id, reservaId (unique), metodo (enum: PIX, CARTAO, DINHEIRO), valor (Decimal), pagoEm
- Ingresso: id, codigo (unique), reservaId, sessaoAssentoId (unique), utilizadoEm (opcional), validadoPorId (opcional, FK para Usuario), emitidoEm

Requisitos:
- @@map/@map para snake_case no banco; relações nomeadas quando houver mais de uma FK para a mesma tabela (Ingresso.validadoPor).
- onDelete explícito em todas as relações (Restrict onde a exclusão quebraria o histórico de vendas, Cascade só onde fizer sentido, como Assento em Sala sem sessões).
- Gere a migration inicial: `npx prisma migrate dev --name init`.
- Crie uma SEGUNDA migration com --create-only chamada "constraints_check" contendo os CHECKs que o Prisma não expressa: preco > 0, numero > 0, duracao_minutos > 0, e (status <> 'RESERVADO' OR reservado_ate IS NOT NULL) em sessao_assento. Aplique-a.

Ao final:
1. Mostre o SQL gerado das duas migrations;
2. Gere um diagrama ER em Mermaid (erDiagram) com todas as tabelas, PKs, FKs e cardinalidades e salve em docs/der.md;
3. Explique, em poucas linhas, por que SessaoAssento existe (em vez de calcular a disponibilidade só a partir dos ingressos) e como as constraints garantem a unicidade do assento por sessão.
```
