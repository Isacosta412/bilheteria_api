# B09 – Deploy em produção (backend + PostgreSQL gerenciado)

> O enunciado pede um "provedor cloud (por exemplo AWS, Azure ou GCP), com banco PostgreSQL gerenciado". **Confirme com o professor** se plataformas como Render ou Railway são aceitas. Se não forem, use uma das opções "big 3" abaixo. Dica: o **Azure for Students** dá crédito sem cartão de crédito usando o e-mail da universidade.

Escolha UMA opção e cole o prompt correspondente.

## Opção 1 – Azure (App Service + Azure Database for PostgreSQL Flexible Server)
```
Prepare o projeto para deploy no Azure App Service (Linux, Node 20) com o Azure Database for PostgreSQL Flexible Server.
1. Ajuste package.json: "build" compila para dist/, "start" roda `node dist/server.js`, e crie o script "start:prod" que roda `prisma migrate deploy && node dist/server.js`.
2. O servidor deve escutar em process.env.PORT. A DATABASE_URL deve conter ?sslmode=require.
3. Crie o workflow .github/workflows/deploy.yml: em push na main → npm ci → build → testes (com um serviço postgres no Actions) → deploy via azure/webapps-deploy usando o publish profile em secret AZURE_WEBAPP_PUBLISH_PROFILE.
4. Escreva docs/deploy.md com o passo a passo no portal ou via az CLI: criar o resource group, o Postgres Flexible Server (tier Burstable B1ms), a regra de firewall "Allow Azure services", o App Service, as variáveis de ambiente (DATABASE_URL, JWT_SECRET, CORS_ORIGIN, RESERVA_MINUTOS, NODE_ENV=production), o startup command e como rodar o seed uma única vez.
5. Crie a checagem pós-deploy: script `npm run smoke -- --url <URL>` que testa /health, login do operador e GET /sessoes.
```

## Opção 2 – AWS (App Runner ou Elastic Beanstalk + RDS PostgreSQL)
```
Prepare o projeto para deploy na AWS: RDS PostgreSQL (db.t4g.micro, free tier) + App Runner a partir de um Dockerfile.
1. Crie um Dockerfile multi-stage (build com devDependencies; runtime node:20-slim só com dist, node_modules de produção e prisma; o CMD roda `npx prisma migrate deploy && node dist/server.js`). Inclua .dockerignore.
2. Explique em docs/deploy.md: criar o RDS (acesso público só se necessário e com security group restrito), habilitar SSL, enviar a imagem ao ECR, criar o serviço App Runner com as variáveis de ambiente, health check em /health e o seed único.
3. Workflow do GitHub Actions: build → testes → push no ECR → o App Runner faz o deploy automático.
4. Script `npm run smoke -- --url <URL>`.
```

## Opção 3 – GCP (Cloud Run + Cloud SQL for PostgreSQL)
```
Prepare o projeto para deploy no Google Cloud Run com Cloud SQL for PostgreSQL.
1. Dockerfile multi-stage como o descrito para a AWS; o servidor escuta em PORT (8080).
2. docs/deploy.md: criar a instância Cloud SQL (db-f1-micro), conexão via Cloud SQL connector (--add-cloudsql-instances) com DATABASE_URL usando o socket /cloudsql/..., segredos no Secret Manager, `gcloud run deploy` e a migration via Cloud Run Job ou no start.
3. Workflow do GitHub Actions com google-github-actions/deploy-cloudrun.
4. Script `npm run smoke -- --url <URL>`.
```

## Depois do deploy (qualquer opção)
```
Com a API no ar em <URL>:
1. Rode o smoke test e o script de concorrência contra produção e me mostre o resultado.
2. Rode o seed em produção.
3. Confira se o job de expiração está rodando (logs) e se /docs abre.
4. Atualize o README com a URL de produção, o link do Swagger e as credenciais de demonstração (só as do seed de demo, nunca o JWT_SECRET).
```
