import { forwardRef, Module } from '@nestjs/common';
import { GameGateway } from './game.gateway.js';
import { GameRoomService } from './services/game-room.service.js';
import { RoomTimerService } from './services/room-timer.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BotModule } from '../bot/bot.module.js';
import { MatchmakingModule } from '../matchmaking/matchmaking.module.js';

@Module({
  imports: [PrismaModule, forwardRef(() => BotModule), forwardRef(() => MatchmakingModule)],
  providers: [GameGateway, GameRoomService, RoomTimerService],
  exports: [GameRoomService, RoomTimerService, GameGateway],
})
export class GameRoomModule {}