import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateRazorpayOrderDto {
  @IsNumber()
  @Min(1)
  @Max(100000)
  amount!: number;

  @IsOptional()
  @IsString()
  @IsIn(['INR'])
  currency?: string = 'INR';

  @IsOptional()
  @IsString()
  receipt?: string;

  @IsOptional()
  @IsObject()
  notes?: Record<string, string>;
}
