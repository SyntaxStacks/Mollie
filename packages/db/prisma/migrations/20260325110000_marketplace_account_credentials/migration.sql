-- CreateEnum
CREATE TYPE "MarketplaceCredentialType" AS ENUM ('SECRET_REF', 'OAUTH_TOKEN_SET');

-- CreateEnum
CREATE TYPE "CredentialValidationStatus" AS ENUM ('UNVERIFIED', 'VALID', 'INVALID', 'NEEDS_REFRESH');

-- AlterTable
ALTER TABLE "MarketplaceAccount"
    ADD COLUMN "credentialType" "MarketplaceCredentialType" NOT NULL DEFAULT 'SECRET_REF',
    ADD COLUMN "validationStatus" "CredentialValidationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN "externalAccountId" TEXT,
    ADD COLUMN "credentialMetadataJson" JSONB,
    ADD COLUMN "credentialPayloadJson" JSONB,
    ADD COLUMN "lastValidatedAt" TIMESTAMP(3);
