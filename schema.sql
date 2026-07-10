CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'request',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  reward INTEGER NOT NULL CHECK (reward >= 10),
  participant_limit INTEGER NOT NULL DEFAULT 1,
  owner_name TEXT NOT NULL,
  owner_telegram TEXT,
  owner_wallet TEXT,
  owner_contact TEXT,
  deposit_wallet TEXT NOT NULL DEFAULT '0xf3542c8A751f880ed6E046881cBF1E3D707d9492',
  creation_fee INTEGER NOT NULL DEFAULT 5,
  total_deposit INTEGER,
  deposit_tx TEXT,
  deposit_status TEXT NOT NULL DEFAULT 'pending',
  verification_kind TEXT NOT NULL DEFAULT 'manual',
  validation_value TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  claimant_name TEXT NOT NULL,
  claimant_telegram TEXT,
  claimant_chat_id TEXT,
  claimant_wallet TEXT NOT NULL,
  claimant_contact TEXT,
  proof TEXT NOT NULL,
  screenshot_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  verifier_note TEXT,
  paid_amount INTEGER,
  payment_tx TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  paid_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks (id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_claims_task_contact ON claims (task_id, claimant_contact);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_task_wallet ON claims (task_id, claimant_wallet);
