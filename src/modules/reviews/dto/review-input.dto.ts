import { BadRequestException } from '@nestjs/common';

export type ReviewInput = {
  rating: number;
  comment?: string;
};

export function parseReviewInput(body: Record<string, unknown>): ReviewInput {
  const rating = Number(body.rating);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new BadRequestException('Rating must be an integer from 1 to 5');
  }

  const rawComment =
    typeof body.comment === 'string' ? body.comment.trim() : '';

  if (rawComment.length > 500) {
    throw new BadRequestException(
      'Review comment must be 500 characters or fewer',
    );
  }

  return {
    rating,
    comment: rawComment.length > 0 ? rawComment : undefined,
  };
}
