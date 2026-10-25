import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  /**
   * Optional if phoneNumber or identifier is provided.
   */
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;

  /**
   * Optional if email or identifier is provided.
   * Supports standard international and local phone formats.
   */
  @IsOptional()
  @IsString({ message: 'Phone number must be a string' })
  phoneNumber?: string;

  /**
   * Unified identifier field accepting either Email OR Phone number.
   * Ideal for Flutter/Mobile UI "Email or phone" input fields.
   */
  @IsOptional()
  @IsString()
  identifier?: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Display name must be at least 2 characters long' })
  @MaxLength(30, { message: 'Display name must not exceed 30 characters' })
  displayName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
