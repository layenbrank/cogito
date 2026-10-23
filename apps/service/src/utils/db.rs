use sea_orm::{DbErr, RuntimeErr};

fn sqlstate(err: &DbErr) -> Option<String> {
    match err {
        DbErr::Exec(RuntimeErr::SqlxError(e)) | DbErr::Query(RuntimeErr::SqlxError(e)) => e
            .as_database_error()
            .and_then(|db| db.code().map(|c| c.into())),
        _ => None,
    }
}

/// PostgreSQL unique_violation (SQLSTATE 23505).
pub fn is_unique_violation(err: &DbErr) -> bool {
    if sqlstate(err).as_deref() == Some("23505") {
        return true;
    }
    let msg = err.to_string().to_lowercase();
    msg.contains("duplicate key") || msg.contains("unique constraint")
}

/// PostgreSQL foreign_key_violation (SQLSTATE 23503)。
/// 常见于 cancel 硬删会话后，并发 chunk 仍写入已删除的 asset。
pub fn is_fk_violation(err: &DbErr) -> bool {
    if sqlstate(err).as_deref() == Some("23503") {
        return true;
    }
    let msg = err.to_string().to_lowercase();
    msg.contains("foreign key") || msg.contains("违反外键")
}

/// PostgreSQL insufficient_privilege (SQLSTATE 42501)。
/// RLS 拒绝越租户写入时 PostgreSQL 报此码，可用于把"越权"与"脏数据"区分开。
pub fn is_row_security_violation(err: &DbErr) -> bool {
    if sqlstate(err).as_deref() == Some("42501") {
        return true;
    }
    let msg = err.to_string().to_lowercase();
    msg.contains("row-level security") || msg.contains("行级安全")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_duplicate_key_message() {
        let err = DbErr::Custom("duplicate key value violates unique constraint".into());
        assert!(is_unique_violation(&err));
    }

    #[test]
    fn detects_fk_violation_message() {
        let err = DbErr::Custom("插入或更新表 \"chunk\" 违反外键约束 \"fk_chunk_asset\"".into());
        assert!(is_fk_violation(&err));
        assert!(!is_unique_violation(&err));
    }

    #[test]
    fn detects_row_security_violation_message() {
        let err = DbErr::Custom(
            "new row violates row-level security policy for table \"subscription\"".into(),
        );
        assert!(is_row_security_violation(&err));
        assert!(!is_unique_violation(&err));
    }

    #[test]
    fn ignores_unrelated_error() {
        let err = DbErr::Custom("connection reset".into());
        assert!(!is_unique_violation(&err));
        assert!(!is_fk_violation(&err));
        assert!(!is_row_security_violation(&err));
    }
}
