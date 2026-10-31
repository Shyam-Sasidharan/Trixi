import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import type { GameMode, KingdomType } from '../../game-engine/types/contract.types.js';

export class CreateRoomDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsEnum(['SOLO', 'TEAM'])
  @IsOptional()
  gameMode?: GameMode;

  @IsEnum(['FREE_MERCY', 'COMPLEX'])
  @IsOptional()
  kingdomType?: KingdomType;

  @IsNumber()
  @IsOptional()
  turnTime?: number;

  @IsBoolean()
  @IsOptional()
  allowSpectators?: boolean;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  @IsBoolean()
  @IsOptional()
  allowBots?: boolean;
}

