# B05 – Mapa de assentos, reserva e concorrência (o coração do trabalho)

```
Este é o ponto mais importante da avaliação (regras de negócio peso 4, transações e concorrência peso 2). Use o Plan Mode, mostre o plano e explique a estratégia de concorrência ANTES de codar.

1. GET /sessoes/:id/assentos → mapa da sessão:
   { sessao: {...}, filas: [ { fila: "A", assentos: [ { assentoId, numero, tipo, status } ] } ], resumo: { livres, reservados, vendidos } }
   Assentos RESERVADO com reservadoAte < now() devem aparecer como LIVRE (o service trata isso; não dependa só do job).
   Se o usuário logado for o dono da reserva, marque esses assentos com "minhaReserva": true.
   NÃO exponha reservaId nem dados de outros clientes.

2. POST /reservas { sessaoId, assentoIds: string[] } (CLIENTE ou OPERADOR)
   Service:
   - valida: de 1 a 10 assentos, sem repetidos, sessão futura, não cancelada, e todos os assentos pertencem à sala da sessão;
   - opcional: o cliente só pode ter 1 reserva PENDENTE por sessão;
   - dentro de UMA transação (via repository que recebe o tx):
       a) cria a reserva PENDENTE com expiraEm = now + RESERVA_MINUTOS e total = qtd × preco;
       b) executa o UPDATE condicional atômico descrito no CLAUDE.md (regra 3) com $executeRaw parametrizado (Prisma.sql), retornando a contagem;
       c) se a contagem for diferente da quantidade pedida → lança Conflito('ASSENTO_INDISPONIVEL'); a transação faz rollback e nada fica gravado.
   - Explique nos comentários por que isso é seguro: o UPDATE trava as linhas, e a segunda transação concorrente espera e reavalia o WHERE (READ COMMITTED), afetando 0 linhas.
   Resposta: { reservaId, expiraEm, total, assentos: [...] }

3. GET /reservas/minhas, GET /reservas/:id (só o dono ou um OPERADOR), DELETE /reservas/:id (cancela uma reserva PENDENTE e libera os assentos, em transação).

4. Job src/jobs/expirarReservas.ts: node-cron a cada minuto chama reservaService.expirarVencidas(), que chama o repository, que executa `CALL sp_expirar_reservas()`. Logue a quantidade expirada. Desative o job quando NODE_ENV=test.

5. TESTE DE CONCORRÊNCIA (obrigatório, vou demonstrar na apresentação):
   - tests/concorrencia.test.ts: cria uma sessão, dois clientes e dispara 20 POST /reservas simultâneos (Promise.all) para o MESMO assento. Espera exatamente 1 status 201 e 19 status 409, e no banco exatamente 1 sessao_assento RESERVADO para esse assento.
   - Um teste de expiração: reserva com RESERVA_MINUTOS curto (ou expiraEm forçado no passado) → CALL da procedure → assento LIVRE e reserva EXPIRADA → outro cliente consegue reservar.
   - scripts/teste-concorrencia.ts: script executável (`npm run demo:concorrencia -- --url https://minha-api...`) que faz o mesmo contra a API em produção e imprime um resumo bonito no terminal. Vou usar ao vivo.

Rode todos os testes e me mostre a saída.
```
