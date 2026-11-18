import bcrypt from 'bcryptjs';
import { NaoAutenticado } from '../errors';
import { usuarioRepository } from '../repositories/usuario.repository';
import type { LoginEntrada } from '../schemas/auth.schema';
import type { LoginDTO, UsuarioDTO } from '../types/usuario';
import { tokenService } from './token.service';
import { paraUsuarioDTO } from './usuario.service';

// Hash de uma senha aleatória, usado só para gastar o mesmo tempo quando o e-mail não existe.
// Sem isso, a resposta mais rápida revelaria quais e-mails estão cadastrados.
const HASH_FICTICIO = bcrypt.hashSync('senha-ficticia-para-tempo-constante', 10);

const credenciaisInvalidas = (): NaoAutenticado =>
  new NaoAutenticado('E-mail ou senha inválidos.', 'CREDENCIAIS_INVALIDAS');

export const authService = {
  async login(dados: LoginEntrada): Promise<LoginDTO> {
    const usuario = await usuarioRepository.buscarComSenhaPorEmail(dados.email);
    const senhaConfere = await bcrypt.compare(dados.senha, usuario?.senhaHash ?? HASH_FICTICIO);

    if (!usuario || !senhaConfere) {
      throw credenciaisInvalidas();
    }

    const { senhaHash: _descartado, ...publico } = usuario;
    const token = tokenService.gerar({ id: usuario.id, papel: usuario.papel });
    return { token, usuario: paraUsuarioDTO(publico) };
  },

  /** Usuário do token. Se a conta não existe mais, o token deixa de valer. */
  async usuarioAtual(id: number): Promise<UsuarioDTO> {
    const usuario = await usuarioRepository.buscarPorId(id);
    if (!usuario) {
      throw new NaoAutenticado('Sessão inválida ou expirada. Faça login novamente.', 'TOKEN_INVALIDO');
    }
    return paraUsuarioDTO(usuario);
  },
};
