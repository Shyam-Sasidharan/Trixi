import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { GameRoomModule } from './game-room/game-room.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { HealthModule } from './health/health.module.js';
import { BotModule } from './bot/bot.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    GameRoomModule,
    BotModule,
    MatchmakingModule,
    AuthModule,
    UsersModule,
    LeaderboardModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}