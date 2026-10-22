import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../common/redis/redis.module.js';
import { GameRoomModule } from '../game-room/game-room.module.js';

@Module({
  imports: [PrismaModule, RedisModule, GameRoomModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
