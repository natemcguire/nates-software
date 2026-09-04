PRAGMA foreign_keys = ON;

UPDATE app_listings
SET hostname = id
WHERE hostname IS NULL;

CREATE TRIGGER IF NOT EXISTS app_listings_reserved_hostname_guard_insert
BEFORE INSERT ON app_listings
BEGIN
    SELECT RAISE(ABORT, 'reserved app id/hostname cannot be used for app_listings')
    WHERE lower(NEW.id) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          )
       OR (NEW.hostname IS NOT NULL AND lower(NEW.hostname) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          ));
END;

CREATE TRIGGER IF NOT EXISTS app_listings_reserved_hostname_guard_update
BEFORE UPDATE OF hostname, id ON app_listings
BEGIN
    SELECT RAISE(ABORT, 'reserved app id/hostname cannot be used for app_listings')
    WHERE lower(NEW.id) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          )
       OR (NEW.hostname IS NOT NULL AND lower(NEW.hostname) IN (
            'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
            'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
            'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile'
          ));
END;
