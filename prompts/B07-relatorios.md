# B07 – Relatórios gerenciais (vendas e ocupação)

```
Use o Plan Mode. Rotas somente para OPERADOR.

1. GET /relatorios/sessoes?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&filmeId=&salaId=
   - Repository: consulta a VIEW vw_relatorio_sessoes com $queryRaw parametrizado (Prisma.sql, sem concatenar strings) e tipa o retorno com um tipo explícito (RelatorioSessaoRow). Converta bigint/Decimal para number/string de forma segura.
   - Service: valida o período (máx. 1 ano, inicio <= fim) e calcula os totais gerais: ingressos vendidos, receita total, ocupação média ponderada.
   - Resposta: { periodo, totais: {...}, sessoes: [ {...} ] }

2. GET /relatorios/vendas?inicio=&fim=&agrupar=dia|filme|metodo
   - Consulta com Prisma (groupBy ou $queryRaw) que junte no mínimo pagamento + reserva + sessao + filme (3+ tabelas, exigência do enunciado), com receita e quantidade de ingressos por grupo e separação por canal (APP vs BALCAO).

3. GET /relatorios/sessoes.csv (mesmos filtros) → exportação CSV (Content-Type text/csv, separador ;, para abrir no Excel em pt-BR).

4. Escreva em docs/sql.md a seção "Relatório gerencial" com a query, as tabelas envolvidas e um exemplo de saída.

Testes: com um seed controlado (1 sala de 10 lugares, 3 vendidos e 2 reservados), a view retorna taxa_ocupacao = 30.00 e a receita correta.
```
