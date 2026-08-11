-- PostgreSQL schema for durable audit storage.
CREATE TABLE "AuditLogs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_username VARCHAR(100) NOT NULL,
  actor_role VARCHAR(50) NOT NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(100),
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "AuditLogs_entity_idx" ON "AuditLogs" (entity_type, entity_id, created_at DESC);
CREATE INDEX "AuditLogs_actor_idx" ON "AuditLogs" (actor_username, created_at DESC);
CREATE INDEX "AuditLogs_created_at_idx" ON "AuditLogs" (created_at DESC);