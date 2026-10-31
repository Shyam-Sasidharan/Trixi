import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameGateway } from './game.gateway.js';
import { GameRoomService } from './services/game-room.service.js';
import { RoomTimerService } from './services/room-timer.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BotModule } from '../bot/bot.module.js';
import { MatchmakingModule } from '../matchmaking/matchmaking.module.js';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'trix-secret-key-change-in-production' }),
    forwardRef(() => BotModule),
    forwardRef(() => MatchmakingModule),
  ],
  providers: [GameGateway, GameRoomService, RoomTimerService],
  exports: [GameRoomService, RoomTimerService, GameGateway],
})
export class GameRoomModule {}