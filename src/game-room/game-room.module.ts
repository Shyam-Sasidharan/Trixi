import { forwardRef, Module } from '@nestjs/common';
import { GameGateway } from './game.gateway.js';
import { GameRoomService } from './services/game-room.service.js';
import { RoomTimerService } from './services/room-timer.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BotModule } from '../bot/bot.module.js';

@Module({
  imports: [PrismaModule, forwardRef(() => BotModule)],
  providers: [GameGateway, GameRoomService, RoomTimerService],
  exports: [GameRoomService, RoomTimerService, GameGateway],
})
export class GameRoomModule {}