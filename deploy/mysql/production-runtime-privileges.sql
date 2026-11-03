-- MySQL image creates MYSQL_USER with broad privileges during first initialization.
-- Reduce the runtime account to application CRUD after schema initialization.
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'vocabup_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON vocabup.* TO 'vocabup_app'@'%';
FLUSH PRIVILEGES;
