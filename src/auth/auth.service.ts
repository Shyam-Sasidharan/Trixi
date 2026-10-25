import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../common/redis/redis.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { JwtPayload } from '../common/guards/auth.guard.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret = process.env.JWT_SECRET || 'trix-secret-key-change-in-production';
  private readonly refreshSecret = process.env.JWT_REFRESH_SECRET || 'trix-refresh-secret-key-change-in-production';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Normalizes mobile phone numbers by removing spaces, dashes, parentheses.
   * Converts leading '00' to '+'. Enforces standard numeric format.
   */
  public normalizePhoneNumber(phone: string): string {
    const trimmed = phone.trim();
    // Replace leading 00 with +
    let cleaned = trimmed.replace(/^00/, '+');
    // Remove all whitespace, dashes, parentheses, dots
    cleaned = cleaned.replace(/[\s\-\(\)\.]/g, '');

    // Validate: optional leading +, followed by 7 to 15 digits
    const phoneRegex = /^\+?[0-9]{7,15}$/;
    if (!phoneRegex.test(cleaned)) {
      throw new BadRequestException('Invalid mobile phone number format');
    }

    return cleaned;
  }

  /**
   * Registers a new player using either Email OR Phone Number (or both).
   */
  async register(dto: RegisterDto) {
    let rawEmail: string | undefined = dto.email;
    let rawPhone: string | undefined = dto.phoneNumber;

    // Support unified "identifier" input from Flutter/mobile forms
    if (dto.identifier && dto.identifier.trim()) {
      const idVal = dto.identifier.trim();
      if (idVal.includes('@')) {
        rawEmail = rawEmail || idVal;
      } else {
        rawPhone = rawPhone || idVal;
      }
    }

    if (!rawEmail && !rawPhone) {
      throw new BadRequestException('Either an email address or mobile phone number must be provided');
    }

    let normalizedEmail: string | undefined;
    if (rawEmail && rawEmail.trim()) {
      normalizedEmail = rawEmail.trim().toLowerCase();
      // Basic email structure check
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        throw new BadRequestException('Invalid email address format');
      }

      const existingByEmail = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingByEmail) {
        throw new ConflictException('A user with this email address already exists');
      }
    }

    let normalizedPhone: string | undefined;
    if (rawPhone && rawPhone.trim()) {
      normalizedPhone = this.normalizePhoneNumber(rawPhone);

      const existingByPhone = await this.prisma.user.findUnique({
        where: { phoneNumber: normalizedPhone },
      });

      if (existingByPhone) {
        throw new ConflictException('A user with this mobile phone number already exists');
      }
    }

    // Determine displayName
    let displayName = dto.displayName?.trim();
    if (!displayName) {
      if (normalizedEmail) {
        displayName = normalizedEmail.split('@')[0];
      } else if (normalizedPhone) {
        displayName = `Player_${normalizedPhone.slice(-4)}`;
      } else {
        displayName = 'Player';
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: normalizedEmail || null,
            phoneNumber: normalizedPhone || null,
            passwordHash,
            displayName,
            avatarUrl: dto.avatarUrl,
            settings: {
              create: {},
            },
            stats: {
              create: {},
            },
          },
          include: {
            settings: true,
            stats: true,
          },
        });

        return newUser;
      });

      const tokens = await this.generateTokens(
        user.id,
        user.email,
        user.phoneNumber,
        user.displayName,
      );
      await this.saveRefreshToken(user.id, tokens.refreshToken);

      return {
        user: this.sanitizeUser(user),
        tokens,
      };
    } catch (err: unknown) {
      if (err instanceof ConflictException || err instanceof BadRequestException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to register user: ${message}`);
      throw new InternalServerErrorException('Failed to complete user registration');
    }
  }

  /**
   * Logs in a player using unified identifier (Email OR Phone Number) and password.
   */
  async login(dto: LoginDto) {
    const rawIdentifier = (dto.identifier || dto.email || dto.phoneNumber || '').trim();

    if (!rawIdentifier) {
      throw new BadRequestException('Email or phone number is required');
    }

    let user;

    if (rawIdentifier.includes('@')) {
      // Identifier is an email
      const normalizedEmail = rawIdentifier.toLowerCase();
      user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: {
          settings: true,
          stats: true,
        },
      });
    } else {
      // Identifier is a phone number
      let normalizedPhone = rawIdentifier;
      try {
        normalizedPhone = this.normalizePhoneNumber(rawIdentifier);
      } catch {
        // Fallback to searching raw identifier if non-standard
      }

      user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { phoneNumber: normalizedPhone },
            { phoneNumber: rawIdentifier },
          ],
        },
        include: {
          settings: true,
          stats: true,
        },
      });
    }

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email, phone number, or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email, phone number, or password');
    }

    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.phoneNumber,
      user.displayName,
    );
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(dto.refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new NotFoundException('User associated with token not found');
    }

    const activeTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        expiresAt: { gt: new Date() },
      },
    });

    let matchedTokenRecord: (typeof activeTokens)[0] | null = null;
    for (const record of activeTokens) {
      const matches = await bcrypt.compare(dto.refreshToken, record.tokenHash);
      if (matches) {
        matchedTokenRecord = record;
        break;
      }
    }

    if (!matchedTokenRecord) {
      throw new UnauthorizedException('Refresh token is invalid or has been revoked');
    }

    await this.prisma.refreshToken.delete({
      where: { id: matchedTokenRecord.id },
    });

    const newTokens = await this.generateTokens(
      user.id,
      user.email,
      user.phoneNumber,
      user.displayName,
    );
    await this.saveRefreshToken(user.id, newTokens.refreshToken);

    return {
      tokens: newTokens,
    };
  }

  async logout(userId: string, accessToken?: string): Promise<{ message: string }> {
    if (accessToken) {
      try {
        const decoded = this.jwtService.decode<{ exp?: number }>(accessToken);
        if (decoded?.exp) {
          const currentTime = Math.floor(Date.now() / 1000);
          const ttlSeconds = decoded.exp - currentTime;
          if (ttlSeconds > 0) {
            await this.redisService.blacklistToken(accessToken, ttlSeconds);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Could not blacklist access token on logout: ${message}`);
      }
    }

    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return { message: 'Successfully logged out' };
  }

  private async generateTokens(
    userId: string,
    email?: string | null,
    phoneNumber?: string | null,
    displayName?: string,
  ) {
    const payload: JwtPayload = {
      sub: userId,
      email: email || undefined,
      phoneNumber: phoneNumber || undefined,
      displayName,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.jwtSecret,
        expiresIn: '1h',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.refreshSecret,
        expiresIn: '7d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
    };
  }

  private async saveRefreshToken(userId: string, refreshToken: string) {
    const salt = await bcrypt.genSalt(10);
    const tokenHash = await bcrypt.hash(refreshToken, salt);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });
  }

  private sanitizeUser<T extends { passwordHash?: string | null }>(user: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _, ...sanitized } = user;
    return sanitized;
  }
}
