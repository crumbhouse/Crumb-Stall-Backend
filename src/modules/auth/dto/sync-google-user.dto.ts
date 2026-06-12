import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

export class SyncGoogleUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string | null;

  @IsString()
  @MinLength(1)
  providerId!: string;
}
