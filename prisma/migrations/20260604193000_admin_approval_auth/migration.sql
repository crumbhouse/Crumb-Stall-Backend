ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE "AuthProvider" ADD VALUE IF NOT EXISTS 'CREDENTIALS';

DO $$ BEGIN
  CREATE TYPE "AdminApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT,
  ADD COLUMN IF NOT EXISTS "adminApprovalStatus" "AdminApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "adminRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "adminApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "adminApprovedByEmail" TEXT;

CREATE INDEX IF NOT EXISTS "User_role_adminApprovalStatus_idx" ON "User"("role", "adminApprovalStatus");
