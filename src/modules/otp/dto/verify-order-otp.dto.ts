import { IsString, Matches } from 'class-validator';

export class VerifyOrderOtpDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be a six digit code' })
  otp!: string;
}
