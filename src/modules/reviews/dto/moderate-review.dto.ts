import { IsBoolean } from 'class-validator';

export class ModerateReviewDto {
  @IsBoolean()
  isHidden!: boolean;
}
