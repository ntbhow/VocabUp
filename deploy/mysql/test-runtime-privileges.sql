-- Only the isolated vocabup_test runtime account receives application CRUD permissions.
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'vocabup_test_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON vocabup_test.* TO 'vocabup_test_app'@'%';
FLUSH PRIVILEGES;
