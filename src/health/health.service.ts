import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../common/redis/redis.service.js';
import { GameRoomService } from '../game-room/services/game-room.service.js';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  postgres: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  activeRooms: number;
  uptimeSeconds: number;
  memory: {
    heapUsedMB: string;
    heapTotalMB: string;
    rssMB: string;
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly gameRoomService: GameRoomService,
  ) {}

  public async checkHealth(): Promise<HealthCheckResult> {
    let postgresStatus: 'connected' | 'disconnected' = 'disconnected';
    let redisStatus: 'connected' | 'disconnected' = 'disconnected';

    // 1. Check PostgreSQL
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      postgresStatus = 'connected';
    } catch (err: any) {
      this.logger.error(`PostgreSQL health check failed: ${err.message}`);
    }

    // 2. Check Redis
    try {
      const isPong = await this.redisService.ping();
      redisStatus = isPong ? 'connected' : 'disconnected';
    } catch (err: any) {
      this.logger.warn(`Redis health check failed: ${err.message}`);
    }

    const mem = process.memoryUsage();
    const memory = {
      heapUsedMB: (mem.heapUsed / (1024 * 1024)).toFixed(2),
      heapTotalMB: (mem.heapTotal / (1024 * 1024)).toFixed(2),
      rssMB: (mem.rss / (1024 * 1024)).toFixed(2),
    };

    const activeRooms = this.gameRoomService ? this.gameRoomService.getActiveRoomsCount() : 0;
    const isHealthy = postgresStatus === 'connected';

    const result: HealthCheckResult = {
      status: isHealthy ? 'ok' : 'degraded',
      postgres: postgresStatus,
      redis: redisStatus,
      activeRooms,
      uptimeSeconds: Math.floor(process.uptime()),
      memory,
      timestamp: new Date().toISOString(),
    };

    if (!isHealthy) {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }
}
