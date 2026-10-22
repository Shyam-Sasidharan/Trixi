import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { LeaderboardService, LeaderboardEntry } from './leaderboard.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('global')
  async getGlobalLeaderboard(
    @Query('limit') limit?: string,
  ): Promise<LeaderboardEntry[]> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 100;
    return this.leaderboardService.getGlobalLeaderboard(parsedLimit);
  }

  @Get('friends')
  @UseGuards(AuthGuard)
  async getFriendsLeaderboard(@Req() req: any): Promise<LeaderboardEntry[]> {
    const userId = req.user?.sub || req.user?.id;
    return this.leaderboardService.getFriendsLeaderboard(userId);
  }
}
