import { schedule, type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { reservaService } from '../services/reserva.service';

/**
 * Job de expiração (regra 2): a cada minuto chama reservaService.expirarVencidas(), que executa
 * `CALL sp_expirar_reservas()` no banco. A decisão de QUANDO expirar é da aplicação; a procedure
 * garante que a reserva e os assentos mudam juntos.
 *
 * O job não é a única defesa: o mapa e o UPDATE da reserva já tratam uma reserva vencida como
 * livre, mesmo antes de o job rodar.
 */
export function iniciarJobExpiracao(): ScheduledTask | null {
  if (env.NODE_ENV === 'test') {
    return null;
  }

  return schedule(
    '* * * * *',
    async () => {
      try {
        const qtd = await reservaService.expirarVencidas();
        if (qtd > 0) {
          console.log(`[job] ${qtd} reserva(s) expirada(s) e assentos liberados.`);
        }
      } catch (erro: unknown) {
        // Uma falha (ex.: banco fora do ar por instantes) não derruba o processo; o próximo minuto tenta de novo.
        console.error('[job] falha ao expirar reservas:', erro instanceof Error ? erro.message : erro);
      }
    },
    { name: 'expirar-reservas', noOverlap: true },
  );
}
