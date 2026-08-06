import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto, ctx: { ip?: string; ua?: string }): Promise<TokenPair & { user: SafeUser }> {
    const role = this.resolveSelfServeRole(dto.role);
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password);

    // Recruiters bootstrap an organization; candidates join without one.
    const user = await this.prisma.$transaction(async (tx) => {
      let organizationId: string | null = null;
      if (role === Role.RECRUITER && dto.organizationName) {
        const org = await tx.organization.create({
          data: { name: dto.organizationName, slug: this.slugify(dto.organizationName) },
        });
        organizationId = org.id;
      }
      const created = await tx.user.create({
        data: { email: dto.email, passwordHash, fullName: dto.fullName, role, organizationId },
      });
      if (organizationId) {
        await tx.membership.create({
          data: { userId: created.id, organizationId, role: Role.ORG_ADMIN },
        });
      }
      if (role === Role.CANDIDATE) {
        await tx.candidateProfile.create({ data: { userId: created.id } });
      }
      return created;
    });

    return this.issueTokens(user, ctx);
  }

  async login(dto: LoginDto, ctx: { ip?: string; ua?: string }): Promise<TokenPair & { user: SafeUser }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user, ctx);
  }

  /**
   * Passwordless login for OTP signup — P1 §2: phone-aware. Finds the
   * candidate by phone first (phone is now a real login key, not just an
   * SMS delivery address), then by email, else creates a fresh CANDIDATE.
   * Used by the "Sign Up to Start the Interview" lobby.
   */
  async otpLogin(
    identity: { email?: string; phone?: string; fullName: string },
    ctx: { ip?: string; ua?: string },
  ): Promise<TokenPair & { user: SafeUser }> {
    const { fullName } = identity;
    let user: User | null = null;

    if (identity.phone) {
      user = await this.prisma.user.findUnique({ where: { phone: identity.phone } });
    }
    if (!user && identity.email) {
      user = await this.prisma.user.findUnique({ where: { email: identity.email } });
      // A returning email-only candidate verifying phone for the first
      // time — link it to their existing account rather than create a
      // duplicate.
      if (user && identity.phone && !user.phone) {
        user = await this.prisma.user.update({ where: { id: user.id }, data: { phone: identity.phone, phoneVerified: true } });
      }
    }
    if (!user) {
      // Phone-only signups still need SOME value in the required, unique
      // `email` column. Synthesize a clearly-internal placeholder rather
      // than making `email` nullable schema-wide, which would touch every
      // existing query that assumes `user.email` is a real string
      // (recruiter views, notifications, audit logs). Never shown to the
      // candidate or emailed to anyone — a DB-integrity detail, not a real
      // address.
      const email = identity.email ?? `${(identity.phone ?? randomUUID()).replace(/[^0-9a-zA-Z]/g, '')}@phone.hyrte.internal`;
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            fullName,
            role: Role.CANDIDATE,
            emailVerified: Boolean(identity.email),
            phone: identity.phone,
            phoneVerified: Boolean(identity.phone),
          },
        });
        await tx.candidateProfile.create({ data: { userId: created.id } });
        return created;
      });
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user, ctx);
  }

  async refresh(refreshToken: string, ctx: { ip?: string; ua?: string }): Promise<TokenPair> {
    const tokenHash = this.hash(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Rotate: revoke the used token and mint a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user, ctx);
  }

  /** True if a user with this email exists (for password reset). */
  async userExists(email: string): Promise<boolean> {
    return Boolean(await this.prisma.user.findUnique({ where: { email }, select: { id: true } }));
  }

  /** Set a new password for a user by email (used by password reset). */
  async setPasswordByEmail(email: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new BadRequestException('No account for that email');
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Invalidate existing refresh tokens after a password change.
    await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hash(refreshToken);
    await this.prisma.refreshToken
      .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  // ── internals ──

  private async issueTokens(user: User, ctx: { ip?: string; ua?: string }): Promise<TokenPair & { user: SafeUser }> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: Number(process.env.JWT_ACCESS_TTL ?? 900) },
    );

    // Opaque refresh token; only its hash is persisted.
    const refreshToken = randomUUID() + randomUUID();
    const ttl = Number(process.env.JWT_REFRESH_TTL ?? 1_209_600);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        userAgent: ctx.ua,
        ip: ctx.ip,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    return { accessToken, refreshToken, user: toSafeUser(user) };
  }

  private resolveSelfServeRole(role?: Role): Role {
    const selfServe: Role[] = [Role.CANDIDATE, Role.RECRUITER];
    if (role && !selfServe.includes(role)) {
      throw new BadRequestException('Only CANDIDATE or RECRUITER can self-register');
    }
    return role ?? Role.CANDIDATE;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private slugify(input: string): string {
    return (
      input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      randomUUID().slice(0, 6)
    );
  }
}

export interface SafeUser {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  role: Role;
  organizationId: string | null;
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
  };
}

// Keep a reference so unused Prisma import types are retained for extension.
export type _PrismaUserCreate = Prisma.UserCreateInput;
