-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stellarPublicKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "classification" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseMember" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "permissions" JSONB,

    CONSTRAINT "CaseMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "custodianId" TEXT NOT NULL,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceSource" (
    "id" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "collectorRef" TEXT,
    "issuingOrgRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceVersion" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "objectKey" TEXT NOT NULL,
    "objectVersionId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "immutable" BOOLEAN NOT NULL DEFAULT true,
    "acquiredAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyEvent" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "toUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "signatureRef" TEXT,
    "stellarRef" TEXT,

    CONSTRAINT "CustodyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DerivedArtifact" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "parametersHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DerivedArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'CASE',
    "resourceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attestation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issuerUserId" TEXT,
    "issuerOrgId" TEXT,
    "subjectRef" TEXT NOT NULL,
    "statementHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CHAIN',
    "stellarRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportBundle" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportBundle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_name_idx" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_stellarPublicKey_key" ON "User"("stellarPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_nonce_key" ON "AuthChallenge"("nonce");

-- CreateIndex
CREATE INDEX "AuthChallenge_publicKey_idx" ON "AuthChallenge"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Case_organizationId_ref_key" ON "Case"("organizationId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "CaseMember_caseId_userId_key" ON "CaseMember"("caseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_caseId_ref_key" ON "EvidenceItem"("caseId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_objectKey_key" ON "UploadSession"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceVersion_objectKey_key" ON "EvidenceVersion"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceVersion_evidenceId_version_key" ON "EvidenceVersion"("evidenceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CustodyEvent_eventHash_key" ON "CustodyEvent"("eventHash");

-- CreateIndex
CREATE UNIQUE INDEX "CustodyEvent_idempotencyKey_key" ON "CustodyEvent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DerivedArtifact_objectKey_key" ON "DerivedArtifact"("objectKey");

-- CreateIndex
CREATE INDEX "Record_caseId_kind_idx" ON "Record"("caseId", "kind");

-- CreateIndex
CREATE INDEX "Outbox_queue_sentAt_idx" ON "Outbox"("queue", "sentAt");

-- CreateIndex
CREATE INDEX "Attestation_caseId_subjectRef_idx" ON "Attestation"("caseId", "subjectRef");

-- CreateIndex
CREATE UNIQUE INDEX "ExportBundle_objectKey_key" ON "ExportBundle"("objectKey");

-- CreateIndex
CREATE INDEX "ExportBundle_caseId_idx" ON "ExportBundle"("caseId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseMember" ADD CONSTRAINT "CaseMember_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseMember" ADD CONSTRAINT "CaseMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSource" ADD CONSTRAINT "EvidenceSource_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceVersion" ADD CONSTRAINT "EvidenceVersion_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EvidenceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DerivedArtifact" ADD CONSTRAINT "DerivedArtifact_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EvidenceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBundle" ADD CONSTRAINT "ExportBundle_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reject mutation even when a buggy application attempts it.
CREATE FUNCTION afterprint_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only record cannot be changed'; END; $$;
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON "EvidenceVersion" FOR EACH ROW EXECUTE FUNCTION afterprint_immutable();
CREATE TRIGGER custody_immutable BEFORE UPDATE OR DELETE ON "CustodyEvent" FOR EACH ROW EXECUTE FUNCTION afterprint_immutable();
CREATE TRIGGER artifact_immutable BEFORE UPDATE OR DELETE ON "DerivedArtifact" FOR EACH ROW EXECUTE FUNCTION afterprint_immutable();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AccessEvent" FOR EACH ROW EXECUTE FUNCTION afterprint_immutable();
CREATE FUNCTION afterprint_final_report_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind='reconstruction' AND OLD.data->>'status'='FINALIZED' THEN RAISE EXCEPTION 'finalized reconstruction is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finalized_report_immutable BEFORE UPDATE OR DELETE ON "Record" FOR EACH ROW EXECUTE FUNCTION afterprint_final_report_immutable();
