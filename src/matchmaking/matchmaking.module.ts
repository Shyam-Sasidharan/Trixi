import { forwardRef, Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service.js';
import { GameRoomModule } from '../game-room/game-room.module.js';
import { RedisModule } from '../common/redis/redis.module.js';
import { BotModule } from '../bot/bot.module.js';

@Module({
  imports: [forwardRef(() => GameRoomModule), RedisModule, forwardRef(() => BotModule)],
  providers: [MatchmakingService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
