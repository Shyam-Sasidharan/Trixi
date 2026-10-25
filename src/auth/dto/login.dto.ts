import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  /**
   * Unified identifier field: accepts either Email OR Phone number.
   * Matches Flutter UI single input "Email or phone".
   */
  @IsOptional()
  @IsString()
  identifier?: string;

  /**
   * Maintained for 100% backward compatibility with existing clients and tests.
   */
  @IsOptional()
  @IsString()
  email?: string;

  /**
   * Direct phone number field support.
   */
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}
