CREATE TYPE "CatalogIdentifierType" AS ENUM ('UPC', 'EAN', 'ISBN', 'UNKNOWN');

CREATE TYPE "CatalogTrustStatus" AS ENUM (
  'LOOKUP_DISCOVERED',
  'SEED_TENTATIVE',
  'CRAWLER_DERIVED',
  'OPERATOR_CONFIRMED'
);

CREATE TABLE "CatalogIdentifier" (
  "id" TEXT NOT NULL,
  "normalizedIdentifier" TEXT NOT NULL,
  "identifierType" "CatalogIdentifierType" NOT NULL,
  "canonicalTitle" TEXT,
  "brand" TEXT,
  "category" TEXT,
  "canonicalImageUrlsJson" JSONB,
  "sourceReferencesJson" JSONB,
  "trustStatus" "CatalogTrustStatus" NOT NULL DEFAULT 'LOOKUP_DISCOVERED',
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastConfirmedAt" TIMESTAMP(3),
  "lastRefreshedAt" TIMESTAMP(3),
  "lastLookupAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CatalogIdentifier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogObservation" (
  "id" TEXT NOT NULL,
  "catalogIdentifierId" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "price" DOUBLE PRECISION,
  "sourceUrl" TEXT,
  "note" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "imageUrlsJson" JSONB,
  "provenance" "CatalogTrustStatus" NOT NULL DEFAULT 'CRAWLER_DERIVED',
  "confidenceScore" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CatalogObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceCatalogObservation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "catalogIdentifierId" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "price" DOUBLE PRECISION,
  "sourceUrl" TEXT,
  "note" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceCatalogObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceCatalogOverride" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "catalogIdentifierId" TEXT NOT NULL,
  "title" TEXT,
  "brand" TEXT,
  "category" TEXT,
  "imageUrlsJson" JSONB,
  "lastConfirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceCatalogOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogIdentifier_normalizedIdentifier_key" ON "CatalogIdentifier"("normalizedIdentifier");
CREATE INDEX "CatalogIdentifier_identifierType_updatedAt_idx" ON "CatalogIdentifier"("identifierType", "updatedAt");
CREATE INDEX "CatalogObservation_catalogIdentifierId_observedAt_idx" ON "CatalogObservation"("catalogIdentifierId", "observedAt");
CREATE INDEX "WorkspaceCatalogObservation_workspaceId_observedAt_idx" ON "WorkspaceCatalogObservation"("workspaceId", "observedAt");
CREATE INDEX "WorkspaceCatalogObservation_catalogIdentifierId_observedAt_idx" ON "WorkspaceCatalogObservation"("catalogIdentifierId", "observedAt");
CREATE UNIQUE INDEX "WorkspaceCatalogOverride_workspaceId_catalogIdentifierId_key" ON "WorkspaceCatalogOverride"("workspaceId", "catalogIdentifierId");
CREATE INDEX "WorkspaceCatalogOverride_workspaceId_updatedAt_idx" ON "WorkspaceCatalogOverride"("workspaceId", "updatedAt");

ALTER TABLE "CatalogObservation"
ADD CONSTRAINT "CatalogObservation_catalogIdentifierId_fkey"
FOREIGN KEY ("catalogIdentifierId") REFERENCES "CatalogIdentifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCatalogObservation"
ADD CONSTRAINT "WorkspaceCatalogObservation_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCatalogObservation"
ADD CONSTRAINT "WorkspaceCatalogObservation_catalogIdentifierId_fkey"
FOREIGN KEY ("catalogIdentifierId") REFERENCES "CatalogIdentifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCatalogOverride"
ADD CONSTRAINT "WorkspaceCatalogOverride_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCatalogOverride"
ADD CONSTRAINT "WorkspaceCatalogOverride_catalogIdentifierId_fkey"
FOREIGN KEY ("catalogIdentifierId") REFERENCES "CatalogIdentifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
