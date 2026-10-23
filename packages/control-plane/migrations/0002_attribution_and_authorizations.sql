-- Record which role produced each discovery record, so independence rules
-- (e.g. a brief's author cannot review it) can be enforced.
ALTER TABLE evidence ADD COLUMN submitted_by text NOT NULL DEFAULT 'unknown';
ALTER TABLE opportunity_briefs ADD COLUMN submitted_by text NOT NULL DEFAULT 'unknown';
ALTER TABLE skeptic_reviews ADD COLUMN submitted_by text NOT NULL DEFAULT 'unknown';
ALTER TABLE experiments ADD COLUMN submitted_by text NOT NULL DEFAULT 'unknown';
ALTER TABLE experiment_results ADD COLUMN submitted_by text NOT NULL DEFAULT 'unknown';
ALTER TABLE investment_decisions ADD COLUMN submitted_by text NOT NULL DEFAULT 'unknown';

-- Gated actions approved for a specific experiment version. `via` records how:
-- 'policy' when a rule allowed it, 'owner_approval' when an escalation was approved.
CREATE TABLE experiment_authorizations (
  experiment_id       text NOT NULL,
  experiment_version  integer NOT NULL,
  action              text NOT NULL,
  via                 text NOT NULL CHECK (via IN ('policy', 'owner_approval')),
  policy_decision     jsonb NOT NULL,
  authorized_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, experiment_version, action),
  FOREIGN KEY (experiment_id, experiment_version) REFERENCES experiments (experiment_id, version)
);
CREATE TRIGGER experiment_authorizations_immutable BEFORE UPDATE OR DELETE ON experiment_authorizations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Server-assigned ids so parallel research workers never collide.
CREATE SEQUENCE evidence_number_seq;
CREATE SEQUENCE record_number_seq;

-- Insertion order for "latest" lookups.
ALTER TABLE experiments ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE skeptic_reviews ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE investment_decisions ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
