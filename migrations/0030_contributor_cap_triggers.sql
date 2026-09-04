CREATE TRIGGER IF NOT EXISTS contributor_shares_cap_guard
BEFORE INSERT ON contributor_shares
BEGIN
    SELECT RAISE(ABORT, 'contributor share exceeds available repository grantable pool or repository does not exist')
    WHERE NOT EXISTS (
        SELECT 1 FROM repositories WHERE id = NEW.repository_id
    )
    OR (
        (SELECT COALESCE(SUM(basis_points), 0) FROM contributor_shares WHERE repository_id = NEW.repository_id AND status IN ('active', 'pending')) + NEW.basis_points
        > (SELECT COALESCE(grantable_bps, 0) FROM repositories WHERE id = NEW.repository_id)
    );
END;

CREATE TRIGGER IF NOT EXISTS repositories_grantable_no_strand
BEFORE UPDATE OF grantable_bps ON repositories
WHEN NEW.grantable_bps >= 0 AND NEW.grantable_bps < (
    SELECT COALESCE(SUM(basis_points), 0)
    FROM contributor_shares
    WHERE repository_id = NEW.id AND status IN ('active', 'pending')
)
BEGIN
    SELECT RAISE(ABORT, 'repository grantable_bps cannot be lowered below committed grants');
END;
