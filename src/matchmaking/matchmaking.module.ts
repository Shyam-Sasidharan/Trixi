import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service.js';

@Module({
  providers: [MatchmakingService]
})
export class MatchmakingModule {}
