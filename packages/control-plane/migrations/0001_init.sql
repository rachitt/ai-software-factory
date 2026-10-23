-- Factory control-plane metadata (architecture.md §12).
-- Contract bodies are stored as validated JSONB; frequently queried fields are
-- projected into columns. Versioned records are immutable once written.

CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Discovery -----------------------------------------------------------------

CREATE TABLE opportunities (
  opportunity_id  text PRIMARY KEY,
  category        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunity_briefs (
  opportunity_id  text NOT NULL REFERENCES opportunities,
  version         integer NOT NULL CHECK (version > 0),
  evidence_stage  text NOT NULL,
  body            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, version)
);
CREATE TRIGGER opportunity_briefs_immutable BEFORE UPDATE OR DELETE ON opportunity_briefs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE evidence (
  evidence_id           text PRIMARY KEY,
  opportunity_id        text REFERENCES opportunities,
  source_kind           text NOT NULL,
  source_uri            text NOT NULL,
  retrieved_at          timestamptz NOT NULL,
  published_at          timestamptz,
  stance                text NOT NULL CHECK (stance IN ('supports', 'contradicts', 'context')),
  duplicate_cluster_id  text,
  contributor_key       text,
  is_promotional        boolean NOT NULL,
  body                  jsonb NOT NULL
);
CREATE INDEX evidence_opportunity_idx ON evidence (opportunity_id);

CREATE TABLE skeptic_reviews (
  review_id       text PRIMARY KEY,
  opportunity_id  text NOT NULL REFERENCES opportunities,
  brief_version   integer NOT NULL,
  recommendation  text NOT NULL,
  body            jsonb NOT NULL,
  FOREIGN KEY (opportunity_id, brief_version) REFERENCES opportunity_briefs (opportunity_id, version)
);

CREATE TABLE experiments (
  experiment_id   text NOT NULL,
  version         integer NOT NULL CHECK (version > 0),
  opportunity_id  text NOT NULL REFERENCES opportunities,
  budget_usd_cents bigint NOT NULL CHECK (budget_usd_cents >= 0),
  body            jsonb NOT NULL,
  PRIMARY KEY (experiment_id, version)
);
CREATE TRIGGER experiments_immutable BEFORE UPDATE OR DELETE ON experiments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE experiment_results (
  experiment_id       text NOT NULL,
  experiment_version  integer NOT NULL,
  outcome             text NOT NULL CHECK (outcome IN ('success', 'failure', 'inconclusive')),
  body                jsonb NOT NULL,
  concluded_at        timestamptz NOT NULL,
  FOREIGN KEY (experiment_id, experiment_version) REFERENCES experiments (experiment_id, version)
);

CREATE TABLE investment_decisions (
  decision_id     text PRIMARY KEY,
  opportunity_id  text NOT NULL REFERENCES opportunities,
  decision        text NOT NULL CHECK (decision IN ('build', 'investigate_further', 'reject')),
  body            jsonb NOT NULL,
  decided_at      timestamptz NOT NULL
);

-- Products and specifications ----------------------------------------------

CREATE TABLE products (
  product_id      text PRIMARY KEY,
  category        text NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  opportunity_id  text REFERENCES opportunities,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE specification_versions (
  product_id    text NOT NULL REFERENCES products,
  spec_version  integer NOT NULL CHECK (spec_version > 0),
  body          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, spec_version)
);
CREATE TRIGGER specification_versions_immutable BEFORE UPDATE OR DELETE ON specification_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE requirements (
  product_id      text NOT NULL,
  spec_version    integer NOT NULL,
  requirement_id  text NOT NULL,
  priority        text NOT NULL CHECK (priority IN ('must', 'should', 'could')),
  body            jsonb NOT NULL,
  PRIMARY KEY (product_id, spec_version, requirement_id),
  FOREIGN KEY (product_id, spec_version) REFERENCES specification_versions
);

-- Workflow runs -------------------------------------------------------------
-- The workflow engine owns execution progress; these tables are an idempotent
-- projection of accepted transitions (architecture.md §12).

CREATE TABLE workflow_runs (
  run_id      text PRIMARY KEY,
  machine     text NOT NULL CHECK (machine IN ('opportunity', 'build', 'repair', 'upgrade', 'experiment')),
  subject_id  text NOT NULL,
  state       text NOT NULL,
  resume_to   text,
  seq         integer NOT NULL DEFAULT 0 CHECK (seq >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_runs_subject_idx ON workflow_runs (subject_id);

CREATE TABLE workflow_transitions (
  run_id           text NOT NULL REFERENCES workflow_runs,
  seq              integer NOT NULL CHECK (seq > 0),
  from_state       text NOT NULL,
  to_state         text NOT NULL,
  event            text NOT NULL,
  reason           text,
  idempotency_key  text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);
CREATE TRIGGER workflow_transitions_immutable BEFORE UPDATE OR DELETE ON workflow_transitions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE tasks (
  run_id            text NOT NULL REFERENCES workflow_runs,
  task_id           text NOT NULL,
  product_id        text NOT NULL,
  spec_version      integer NOT NULL,
  role_version      text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ready', 'leased', 'succeeded', 'failed', 'cancelled')),
  contract          jsonb NOT NULL,
  lease_owner       text,
  lease_expires_at  timestamptz,
  PRIMARY KEY (run_id, task_id),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE TABLE agent_attempts (
  attempt_id      text PRIMARY KEY,
  run_id          text NOT NULL,
  task_id         text NOT NULL,
  attempt_number  integer NOT NULL CHECK (attempt_number > 0),
  worker_id       text NOT NULL,
  role_version    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'abandoned')),
  failure_kind    text,
  cost_usd_cents  bigint NOT NULL DEFAULT 0 CHECK (cost_usd_cents >= 0),
  body            jsonb NOT NULL,
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  UNIQUE (run_id, task_id, attempt_number),
  FOREIGN KEY (run_id, task_id) REFERENCES tasks
);

-- Policy and budgets --------------------------------------------------------

CREATE TABLE policies (
  policy_id    text NOT NULL,
  version      integer NOT NULL CHECK (version > 0),
  scope_level  text NOT NULL CHECK (scope_level IN ('portfolio', 'product')),
  product_id   text,
  active       boolean NOT NULL DEFAULT true,
  body         jsonb NOT NULL,
  PRIMARY KEY (policy_id, version),
  CHECK ((scope_level = 'product') = (product_id IS NOT NULL))
);

CREATE TABLE budget_limits (
  scope_level   text NOT NULL CHECK (scope_level IN ('portfolio', 'product', 'run', 'task')),
  scope_id      text NOT NULL,
  resource      text NOT NULL CHECK (resource IN ('usd_cents', 'worker_slots')),
  limit_amount  bigint NOT NULL CHECK (limit_amount >= 0),
  PRIMARY KEY (scope_level, scope_id, resource)
);

CREATE TABLE budget_reservations (
  reservation_key   text PRIMARY KEY,
  resource          text NOT NULL CHECK (resource IN ('usd_cents', 'worker_slots')),
  amount            bigint NOT NULL CHECK (amount >= 0),
  state             text NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  committed_amount  bigint,
  chain             jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Verification and release --------------------------------------------------

CREATE TABLE verification_results (
  result_id        text PRIMARY KEY,
  product_id       text NOT NULL REFERENCES products,
  spec_version     integer NOT NULL,
  criterion_id     text NOT NULL,
  area             text NOT NULL,
  source_commit    text NOT NULL,
  artifact_digest  text NOT NULL,
  status           text NOT NULL CHECK (status IN ('passed', 'failed', 'error', 'skipped')),
  body             jsonb NOT NULL,
  ran_at           timestamptz NOT NULL
);
CREATE INDEX verification_results_candidate_idx
  ON verification_results (product_id, source_commit, artifact_digest);
CREATE TRIGGER verification_results_immutable BEFORE UPDATE OR DELETE ON verification_results
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE findings (
  finding_id  text PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products,
  severity    text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status      text NOT NULL CHECK (status IN ('open', 'fixed', 'accepted_risk', 'invalid')),
  body        jsonb NOT NULL
);

CREATE TABLE releases (
  release_id       text PRIMARY KEY,
  product_id       text NOT NULL REFERENCES products,
  source_commit    text NOT NULL,
  artifact_digest  text NOT NULL,
  manifest         jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER releases_immutable BEFORE UPDATE OR DELETE ON releases
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Foundation ----------------------------------------------------------------

CREATE TABLE foundation_versions (
  module     text NOT NULL,
  version    text NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);

CREATE TABLE product_installations (
  product_id  text NOT NULL REFERENCES products,
  module      text NOT NULL,
  version     text NOT NULL,
  PRIMARY KEY (product_id, module),
  FOREIGN KEY (module, version) REFERENCES foundation_versions
);
