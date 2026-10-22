import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        settings: true,
        stats: true,
        matches: {
          take: 10,
          orderBy: { match: { createdAt: 'desc' } },
          include: {
            match: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    return this.sanitizeUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName ? { displayName: dto.displayName.trim() } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      },
      include: {
        settings: true,
        stats: true,
      },
    });

    return this.sanitizeUser(updated);
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...dto,
      },
      update: {
        ...dto,
      },
    });

    return settings;
  }

  async getLeaderboard(limit = 20) {
    const topUsers = await this.prisma.user.findMany({
      take: Math.min(limit, 100),
      orderBy: {
        stats: {
          wins: 'desc',
        },
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        level: true,
        xp: true,
        coins: true,
        isVip: true,
        stats: {
          select: {
            gamesPlayed: true,
            wins: true,
            losses: true,
            soloWins: true,
            teamWins: true,
            trixFirstPlaceCount: true,
          },
        },
      },
    });

    return topUsers;
  }

  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        level: true,
        xp: true,
        isVip: true,
        createdAt: true,
        stats: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Player not found');
    }

    return user;
  }

  private sanitizeUser<T extends { passwordHash?: string | null }>(user: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _, ...sanitized } = user;
    return sanitized;
  }
}
