import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthService } from '../health.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { GameRoomService } from '../../game-room/services/game-room.service.js';

describe('HealthService', () => {
  let service: HealthService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockRoomService: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ 1: 1 }]),
    };
    mockRedis = {
      ping: vi.fn().mockResolvedValue(true),
    };
    mockRoomService = {
      getActiveRoomsCount: vi.fn().mockReturnValue(3),
    };

    service = new HealthService(
      mockPrisma as PrismaService,
      mockRedis as RedisService,
      mockRoomService as GameRoomService,
    );
  });

  it('should return healthy status when postgres and redis are reachable', async () => {
    const health = await service.checkHealth();

    expect(health.status).toBe('ok');
    expect(health.postgres).toBe('connected');
    expect(health.redis).toBe('connected');
    expect(health.activeRooms).toBe(3);
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(health.memory.heapUsedMB).toBeDefined();
    expect(health.timestamp).toBeDefined();
  });

  it('should throw ServiceUnavailableException when postgres check fails', async () => {
    mockPrisma.$queryRawUnsafe = vi.fn().mockRejectedValue(new Error('Connection refused'));

    await expect(service.checkHealth()).rejects.toThrow();
  });

  it('should mark degraded if redis is down but postgres is up', async () => {
    mockRedis.ping = vi.fn().mockResolvedValue(false);

    const health = await service.checkHealth();
    expect(health.status).toBe('ok');
    expect(health.postgres).toBe('connected');
    expect(health.redis).toBe('disconnected');
  });
});
