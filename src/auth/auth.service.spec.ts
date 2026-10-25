import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../common/redis/redis.service.js';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrismaService = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const mockJwtService = {
    signAsync: vi.fn().mockResolvedValue('test-jwt-token'),
    verifyAsync: vi.fn(),
    decode: vi.fn(),
  };

  const mockRedisService = {
    blacklistToken: vi.fn().mockResolvedValue(true),
    isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPrismaService.$transaction.mockImplementation(async (cb: (tx: typeof mockPrismaService) => unknown) => {
      return cb(mockPrismaService);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('normalizePhoneNumber', () => {
    it('should normalize international format with spaces and dashes', () => {
      expect(service.normalizePhoneNumber('+966 50 123-4567')).toBe('+966501234567');
    });

    it('should convert leading 00 to +', () => {
      expect(service.normalizePhoneNumber('00966501234567')).toBe('+966501234567');
    });

    it('should strip parentheses and dots', () => {
      expect(service.normalizePhoneNumber('+1 (555) 234.5678')).toBe('+15552345678');
    });

    it('should accept pure numeric format without plus', () => {
      expect(service.normalizePhoneNumber('0501234567')).toBe('0501234567');
    });

    it('should throw BadRequestException on invalid characters or invalid length', () => {
      expect(() => service.normalizePhoneNumber('invalid-phone')).toThrow(BadRequestException);
      expect(() => service.normalizePhoneNumber('123')).toThrow(BadRequestException);
      expect(() => service.normalizePhoneNumber('+12345678901234567890')).toThrow(BadRequestException);
    });
  });

  describe('register', () => {
    it('should register successfully with email only (backward compatibility)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const createdUser = {
        id: 'user-email-1',
        email: 'player@example.com',
        phoneNumber: null,
        displayName: 'player',
        avatarUrl: null,
        passwordHash: 'hashed_password',
      };
      mockPrismaService.user.create.mockResolvedValue(createdUser);

      const result = await service.register({
        email: 'player@example.com',
        password: 'password123',
      });

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'player@example.com' },
      });
      expect(result.user).toEqual(
        expect.objectContaining({
          id: 'user-email-1',
          email: 'player@example.com',
          displayName: 'player',
        }),
      );
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBe('test-jwt-token');
    });

    it('should register successfully with mobile phone number only', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const createdUser = {
        id: 'user-phone-1',
        email: null,
        phoneNumber: '+966501234567',
        displayName: 'Player_4567',
        avatarUrl: null,
        passwordHash: 'hashed_password',
      };
      mockPrismaService.user.create.mockResolvedValue(createdUser);

      const result = await service.register({
        phoneNumber: '+966 50 123 4567',
        password: 'password123',
      });

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { phoneNumber: '+966501234567' },
      });
      expect(result.user).toEqual(
        expect.objectContaining({
          id: 'user-phone-1',
          phoneNumber: '+966501234567',
          displayName: 'Player_4567',
        }),
      );
    });

    it('should register successfully using unified identifier as phone number', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      const createdUser = {
        id: 'user-phone-2',
        email: null,
        phoneNumber: '+15551234567',
        displayName: 'GamerX',
        avatarUrl: null,
        passwordHash: 'hashed_password',
      };
      mockPrismaService.user.create.mockResolvedValue(createdUser);

      const result = await service.register({
        identifier: '+15551234567',
        password: 'password123',
        displayName: 'GamerX',
      });

      expect(result.user.displayName).toBe('GamerX');
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { phoneNumber: '+15551234567' },
      });
    });

    it('should throw BadRequestException if neither email nor phone is provided', async () => {
      await expect(
        service.register({
          password: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on invalid email format', async () => {
      await expect(
        service.register({
          email: 'invalid-email-format',
          password: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if email is already taken', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.register({
          email: 'taken@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if phone number is already taken', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.register({
          phoneNumber: '+966501234567',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should login successfully with email identifier', async () => {
      const hashedPassword = await bcrypt.hash('secretPass', 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@trix.local',
        phoneNumber: null,
        displayName: 'TestUser',
        passwordHash: hashedPassword,
      });

      const result = await service.login({
        identifier: 'test@trix.local',
        password: 'secretPass',
      });

      expect(result.user.id).toBe('user-1');
      expect(result.tokens.accessToken).toBe('test-jwt-token');
    });

    it('should login successfully with phone identifier', async () => {
      const hashedPassword = await bcrypt.hash('secretPass', 10);
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-2',
        email: null,
        phoneNumber: '+966501234567',
        displayName: 'Player_4567',
        passwordHash: hashedPassword,
      });

      const result = await service.login({
        identifier: '+966 50 123 4567',
        password: 'secretPass',
      });

      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { phoneNumber: '+966501234567' },
              { phoneNumber: '+966 50 123 4567' },
            ],
          },
        }),
      );
      expect(result.user.id).toBe('user-2');
    });

    it('should login successfully using legacy email field', async () => {
      const hashedPassword = await bcrypt.hash('secretPass', 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-legacy',
        email: 'legacy@trix.local',
        passwordHash: hashedPassword,
      });

      const result = await service.login({
        email: 'legacy@trix.local',
        password: 'secretPass',
      });

      expect(result.user.id).toBe('user-legacy');
    });

    it('should throw BadRequestException if no identifier is provided', async () => {
      await expect(
        service.login({
          password: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException if user is not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          identifier: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      const hashedPassword = await bcrypt.hash('correctPassword', 10);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: hashedPassword,
      });

      await expect(
        service.login({
          identifier: 'user@example.com',
          password: 'wrongPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens when token record is valid', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'test@example.com',
      });

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        phoneNumber: null,
        displayName: 'Test',
      });

      const tokenHash = await bcrypt.hash('valid-refresh-token', 10);
      mockPrismaService.refreshToken.findMany.mockResolvedValue([
        {
          id: 'ref-1',
          userId: 'user-1',
          tokenHash,
          expiresAt: new Date(Date.now() + 10000),
        },
      ]);

      const result = await service.refreshTokens({
        refreshToken: 'valid-refresh-token',
      });

      expect(result.tokens).toBeDefined();
      expect(mockPrismaService.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: 'ref-1' },
      });
    });

    it('should throw UnauthorizedException when JWT verification fails', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      await expect(
        service.refreshTokens({
          refreshToken: 'bad-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should delete refresh tokens and blacklist access token if provided', async () => {
      mockJwtService.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });

      const result = await service.logout('user-1', 'access-token-123');

      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(mockRedisService.blacklistToken).toHaveBeenCalled();
      expect(result.message).toBe('Successfully logged out');
    });
  });
});
