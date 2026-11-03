-- Audit log for user + administrator actions. Never store passwords, JWTs or
-- other credentials here: the API sanitizes metadata before insertion.
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_role ENUM('user','admin') NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NULL,
  target_id BIGINT UNSIGNED NULL,
  ip_address VARCHAR(45) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activity_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_activity_created (created_at),
  INDEX idx_activity_actor (actor_user_id, created_at),
  INDEX idx_activity_action (action, created_at),
  INDEX idx_activity_target (target_type, target_id)
);
