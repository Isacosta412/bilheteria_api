import { env } from './config/env';
import { prisma } from './config/prisma';
import { app } from './app';
import { iniciarJobExpiracao } from './jobs/expirarReservas';

const servidor = app.listen(env.PORT, () => {
  console.log(`bilheteria-api rodando em http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

const jobExpiracao = iniciarJobExpiracao();
if (jobExpiracao) {
  console.log('[job] expiração de reservas agendada: a cada minuto.');
}

function encerrar(sinal: string): void {
  console.log(`${sinal} recebido, encerrando...`);
  void jobExpiracao?.stop();
  servidor.close(() => {
    prisma
      .$disconnect()
      .catch((erro: unknown) => console.error('Erro ao desconectar do banco:', erro))
      .finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
