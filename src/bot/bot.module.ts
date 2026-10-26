import { forwardRef, Module } from '@nestjs/common';
import { BotBrainService } from './bot-brain.service.js';
import { BotFillService } from './bot-fill.service.js';
import { BotActionService } from './bot-action.service.js';
import { GameRoomModule } from '../game-room/game-room.module.js';

@Module({
  imports: [forwardRef(() => GameRoomModule)],
  providers: [BotBrainService, BotFillService, BotActionService],
  exports: [BotBrainService, BotFillService, BotActionService],
})
export class BotModule {}
