import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminRegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(120)
  password!: string;
}
