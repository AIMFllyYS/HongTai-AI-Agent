CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  local_profile_id TEXT PRIMARY KEY NOT NULL,
  remote_account_id TEXT,
  display_name TEXT NOT NULL,
  avatar_uri TEXT,
  business_name TEXT,
  industry TEXT,
  business_tags_json TEXT NOT NULL DEFAULT '[]',
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_connections (
  connection_id TEXT PRIMARY KEY NOT NULL,
  base_url TEXT NOT NULL,
  text_model TEXT NOT NULL,
  vision_model TEXT,
  asr_model TEXT,
  asr_transport TEXT,
  json_object_enabled INTEGER NOT NULL DEFAULT 0,
  json_schema_enabled INTEGER NOT NULL DEFAULT 0,
  probe_results_json TEXT NOT NULL DEFAULT '[]',
  api_key_slot TEXT NOT NULL DEFAULT 'active-ai-connection',
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL,
  current_stage TEXT,
  platform TEXT,
  content_type TEXT,
  speech_status TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'not_started',
  retry_of_task_id TEXT,
  artifact_root_uri TEXT,
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL,
  FOREIGN KEY (retry_of_task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  stage TEXT,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  progress REAL,
  detail_json TEXT,
  issue_code TEXT,
  created_at_epoch_ms INTEGER NOT NULL,
  UNIQUE (task_id, sequence),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_analyses (
  task_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'content-analysis.v1',
  result_uri TEXT,
  issue_code TEXT,
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diagnosis_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  status TEXT NOT NULL,
  report_uri TEXT,
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnosis_messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  is_streaming INTEGER NOT NULL DEFAULT 0,
  created_at_epoch_ms INTEGER NOT NULL,
  UNIQUE (session_id, sequence),
  FOREIGN KEY (session_id) REFERENCES diagnosis_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_sequence ON task_events(task_id, sequence);
CREATE INDEX IF NOT EXISTS idx_diagnosis_messages_session_sequence ON diagnosis_messages(session_id, sequence);

INSERT OR IGNORE INTO schema_migrations(version, applied_at_epoch_ms) VALUES (1, 0);
