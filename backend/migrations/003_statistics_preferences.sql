-- Per-user statistics layout preferences. Additive and cascading: it never
-- touches existing learning data, and deleting a user removes only its layout.
CREATE TABLE IF NOT EXISTS user_statistics_preferences (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  preferences JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stat_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
