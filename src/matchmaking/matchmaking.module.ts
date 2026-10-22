import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service.js';
import { GameRoomModule } from '../game-room/game-room.module.js';
import { RedisModule } from '../common/redis/redis.module.js';

@Module({
  imports: [GameRoomModule, RedisModule],
  providers: [MatchmakingService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
