import { AdminApprovalStatus, UserRole } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role: UserRole;
  adminApprovalStatus: AdminApprovalStatus;
  isSuspended: boolean;
};
