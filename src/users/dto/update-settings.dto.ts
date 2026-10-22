import { AppTheme, CardTheme, TableTheme } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsEnum(AppTheme, { message: 'appTheme must be DARK or LIGHT' })
  appTheme?: AppTheme;

  @IsOptional()
  @IsEnum(CardTheme, { message: 'cardTheme must be CLASSIC, MODERN, or LUXURY' })
  cardTheme?: CardTheme;

  @IsOptional()
  @IsEnum(TableTheme, { message: 'tableTheme must be GREEN_FELT, ROYAL_BLUE, or BURGUNDY' })
  tableTheme?: TableTheme;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  musicEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  vibrationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  chatEnabled?: boolean;
}
