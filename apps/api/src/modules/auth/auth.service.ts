import { Injectable, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import type { RequestUser } from '../../common/request-user.js';
import { capabilitiesByRole } from '../authorization/role-capabilities.js';
import { UsersRepository, type UserRow } from '../users/users.repository.js';

const DUMMY_PASSWORD_HASH = '$2b$12$oMsRoE0SMBoLdJCuWFrKuOosX2xBsOEyKVW/yzvBL2e3yJee9CSA2';

@Injectable()
export class AuthService {
  constructor(private readonly users: UsersRepository) {}

  async authenticate(email: string, password: string): Promise<RequestUser> {
    const user = await this.users.findByEmail(email);
    const passwordMatches = await compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (user === null || !user.active || !passwordMatches)
      throw new UnauthorizedException('Invalid email or password');
    return this.toRequestUser(user);
  }

  async getUser(id: string): Promise<RequestUser> {
    const user = await this.users.findById(id);
    if (user === null) throw new UnauthorizedException('User no longer exists');
    if (!user.active) throw new UnauthorizedException('Account is inactive');
    return this.toRequestUser(user);
  }

  private toRequestUser(user: UserRow): RequestUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      divisionId: user.divisionId,
      sectionId: user.sectionId,
      capabilities: capabilitiesByRole[user.role],
      canAccessConfidential: user.canAccessConfidential,
      active: user.active,
    };
  }
}
