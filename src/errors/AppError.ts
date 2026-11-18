/**
 * Erro de aplicação: lançado pelos services e convertido pelo errorHandler em
 * `{ "erro": { "codigo": "...", "mensagem": "..." } }` com o status HTTP correspondente.
 */
export class AppError extends Error {
  public readonly codigo: string;
  public readonly statusHttp: number;
  public readonly detalhes?: unknown;

  constructor(codigo: string, mensagem: string, statusHttp: number, detalhes?: unknown) {
    super(mensagem);
    this.name = new.target.name;
    this.codigo = codigo;
    this.statusHttp = statusHttp;
    this.detalhes = detalhes;
  }

  get mensagem(): string {
    return this.message;
  }
}
