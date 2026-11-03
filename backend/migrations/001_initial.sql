CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  status ENUM('active','locked') NOT NULL DEFAULT 'active',
  last_active_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_status (role, status),
  INDEX idx_users_created_at (created_at),
  INDEX idx_users_last_active_at (last_active_at)
);

CREATE TABLE IF NOT EXISTS decks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  color VARCHAR(20) NOT NULL DEFAULT '#6c63ff',
  daily_new_limit INT UNSIGNED NOT NULL DEFAULT 20,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  is_favorite TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_decks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_decks_user (user_id),
  INDEX idx_decks_is_public (is_public),
  INDEX idx_decks_user_favorite (user_id, is_favorite),
  INDEX idx_decks_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS cards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  deck_id BIGINT UNSIGNED NOT NULL,
  front VARCHAR(500) NOT NULL,
  back TEXT NOT NULL,
  pronunciation VARCHAR(500) NOT NULL DEFAULT '',
  translation TEXT NULL,
  example TEXT NULL,
  interval_days INT UNSIGNED NOT NULL DEFAULT 0,
  repetitions INT UNSIGNED NOT NULL DEFAULT 0,
  ease_factor DECIMAL(4,2) NOT NULL DEFAULT 2.50,
  due_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  image_url VARCHAR(2048) NULL,
  image_thumbnail_url VARCHAR(2048) NULL,
  image_source VARCHAR(24) NULL,
  image_author VARCHAR(255) NULL,
  image_source_url VARCHAR(2048) NULL,
  image_license VARCHAR(160) NULL,
  image_license_url VARCHAR(2048) NULL,
  image_query VARCHAR(200) NULL,
  image_status ENUM('none','pending','ready','error') NOT NULL DEFAULT 'none',
  image_is_manual TINYINT(1) NOT NULL DEFAULT 0,
  image_is_fallback TINYINT(1) NOT NULL DEFAULT 0,
  image_retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  image_retry_at TIMESTAMP NULL DEFAULT NULL,
  image_updated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cards_deck FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
  INDEX idx_cards_due (deck_id, due_at),
  INDEX idx_cards_front (front),
  INDEX idx_cards_image (deck_id, image_status)
);

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  card_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reviews_user_date (user_id, reviewed_at),
  INDEX idx_reviews_user_rating_date (user_id, rating, reviewed_at),
  INDEX idx_reviews_card_rating_date (card_id, rating, reviewed_at),
  INDEX idx_reviews_card (card_id),
  INDEX idx_reviews_reviewed_at (reviewed_at)
);

-- Shared cache of provider search results, so the same (normalised) query is not
-- sent to Pixabay/Unsplash repeatedly. Contains no user-specific data.
CREATE TABLE IF NOT EXISTS image_search_cache (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  query_key VARCHAR(255) NOT NULL UNIQUE,
  provider VARCHAR(24) NOT NULL,
  status ENUM('ok','empty','error') NOT NULL,
  candidates JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_image_cache_expires (expires_at)
);
