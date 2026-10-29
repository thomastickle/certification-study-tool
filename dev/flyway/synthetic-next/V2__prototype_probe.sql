-- Disposable experiment only. Does not change the authoritative transfer format.
CREATE TABLE prototype_upgrade_probe (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  value TEXT NOT NULL
);
INSERT INTO prototype_upgrade_probe VALUES (1, 'upgraded');
