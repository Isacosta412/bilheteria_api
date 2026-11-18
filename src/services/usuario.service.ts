import bcrypt from 'bcryptjs';
import { Papel } from '@prisma/client';
import { BCRYPT_CUSTO } from '../config/constantes';
import { Conflito, NaoEncontrado } from '../errors';
import { usuarioRepository, type UsuarioPublico } from '../repositories/usuario.repository';
import type { CriarOperadorEntrada, RegistrarEntrada } from '../schemas/auth.schema';
import type { UsuarioDTO } from '../types/usuario';

export function paraUsuarioDTO(usuario: UsuarioPublico): UsuarioDTO {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    criadoEm: usuario.criadoEm.toISOString(),
  };
}

async function criarComPapel(dados: RegistrarEntrada, papel: Papel): Promise<UsuarioDTO> {
  if (await usuarioRepository.existeEmail(dados.email)) {
    throw new Conflito('EMAIL_EM_USO', 'Já existe uma conta com este e-mail.');
  }
  const senhaHash = await bcrypt.hash(dados.senha, BCRYPT_CUSTO);
  // Se dois cadastros simultâneos passarem pela checagem acima, o UNIQUE(email) do banco
  // recusa o segundo (P2002), e o errorHandler devolve 409.
  const usuario = await usuarioRepository.criar({ nome: dados.nome, email: dados.email, senhaHash, papel });
  return paraUsuarioDTO(usuario);
}

export const usuarioService = {
  /** Cadastro público: o papel é sempre CLIENTE, nunca vem do cliente. */
  registrarCliente(dados: RegistrarEntrada): Promise<UsuarioDTO> {
    return criarComPapel(dados, Papel.CLIENTE);
  },

  /** Só operadores chegam aqui (a rota exige o papel OPERADOR). */
  criarOperador(dados: CriarOperadorEntrada): Promise<UsuarioDTO> {
    return criarComPapel(dados, Papel.OPERADOR);
  },

  async buscarPorId(id: number): Promise<UsuarioDTO> {
    const usuario = await usuarioRepository.buscarPorId(id);
    if (!usuario) {
      throw new NaoEncontrado('Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');
    }
    return paraUsuarioDTO(usuario);
  },
};
