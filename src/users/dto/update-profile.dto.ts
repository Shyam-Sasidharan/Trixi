import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Display name must be at least 2 characters long' })
  @MaxLength(30, { message: 'Display name must not exceed 30 characters' })
  displayName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
