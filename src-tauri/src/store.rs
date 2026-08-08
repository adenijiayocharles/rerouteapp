use std::collections::HashMap;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::hosts_parser::ParsedManagedLine;
use crate::models::{Entry, EntryDraft, HistoryEntry, IpCandidate};

pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            hostname TEXT NOT NULL,
            comment TEXT NOT NULL DEFAULT '',
            group_name TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            active_ip_id TEXT NOT NULL DEFAULT '',
            order_index INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ip_candidates (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            ip TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ip_candidates_entry ON ip_candidates(entry_id);
        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            entry_id TEXT,
            hostname TEXT NOT NULL,
            action TEXT NOT NULL,
            before_json TEXT,
            after_json TEXT,
            backup_path TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn human_time(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|dt| dt.with_timezone(&chrono::Local).format("%b %-d, %-I:%M %p").to_string())
        .unwrap_or_else(|_| iso.to_string())
}

fn load_ips_for_entries(
    conn: &Connection,
    entry_ids: &[String],
) -> rusqlite::Result<HashMap<String, Vec<IpCandidate>>> {
    let mut map: HashMap<String, Vec<IpCandidate>> = HashMap::new();
    if entry_ids.is_empty() {
        return Ok(map);
    }
    let placeholders = entry_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT entry_id, id, label, ip FROM ip_candidates WHERE entry_id IN ({placeholders}) ORDER BY order_index ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        entry_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            IpCandidate {
                id: row.get(1)?,
                label: row.get(2)?,
                ip: row.get(3)?,
            },
        ))
    })?;
    for row in rows {
        let (entry_id, ip) = row?;
        map.entry(entry_id).or_default().push(ip);
    }
    Ok(map)
}

pub fn list_entries(conn: &Connection) -> rusqlite::Result<Vec<Entry>> {
    let mut stmt = conn.prepare(
        "SELECT id, hostname, comment, group_name, enabled, active_ip_id, updated_at
         FROM entries ORDER BY order_index ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Entry {
            id: row.get(0)?,
            hostname: row.get(1)?,
            comment: row.get(2)?,
            group: row.get(3)?,
            enabled: row.get::<_, i64>(4)? != 0,
            active_ip_id: row.get(5)?,
            ips: Vec::new(),
            last_modified: human_time(&row.get::<_, String>(6)?),
        })
    })?;
    let mut entries: Vec<Entry> = rows.collect::<rusqlite::Result<_>>()?;
    let ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
    let mut ip_map = load_ips_for_entries(conn, &ids)?;
    for e in entries.iter_mut() {
        e.ips = ip_map.remove(&e.id).unwrap_or_default();
    }
    Ok(entries)
}

pub fn get_entry(conn: &Connection, id: &str) -> rusqlite::Result<Option<Entry>> {
    let result = conn
        .query_row(
            "SELECT id, hostname, comment, group_name, enabled, active_ip_id, updated_at
             FROM entries WHERE id = ?1",
            params![id],
            |row| {
                Ok(Entry {
                    id: row.get(0)?,
                    hostname: row.get(1)?,
                    comment: row.get(2)?,
                    group: row.get(3)?,
                    enabled: row.get::<_, i64>(4)? != 0,
                    active_ip_id: row.get(5)?,
                    ips: Vec::new(),
                    last_modified: human_time(&row.get::<_, String>(6)?),
                })
            },
        )
        .optional()?;
    match result {
        None => Ok(None),
        Some(mut entry) => {
            let mut ip_map = load_ips_for_entries(conn, std::slice::from_ref(&entry.id))?;
            entry.ips = ip_map.remove(&entry.id).unwrap_or_default();
            Ok(Some(entry))
        }
    }
}

fn replace_ip_candidates(
    conn: &Connection,
    entry_id: &str,
    draft: &EntryDraft,
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM ip_candidates WHERE entry_id = ?1", params![entry_id])?;
    let ts = now();
    for (idx, ip) in draft.ips.iter().enumerate() {
        let label = if ip.label.trim().is_empty() {
            ip.ip.clone()
        } else {
            ip.label.clone()
        };
        conn.execute(
            "INSERT INTO ip_candidates (id, entry_id, label, ip, order_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![ip.uid, entry_id, label, ip.ip, idx as i64, ts],
        )?;
    }
    Ok(())
}

/// Inserts a new entry from a draft, returning the persisted entry.
pub fn insert_entry(conn: &Connection, draft: &EntryDraft) -> rusqlite::Result<Entry> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) + 1 FROM entries",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO entries (id, hostname, comment, group_name, enabled, active_ip_id, order_index, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            draft.hostname.trim(),
            draft.comment,
            draft.group.trim(),
            draft.enabled as i64,
            draft.active_uid,
            next_order,
            ts
        ],
    )?;
    replace_ip_candidates(conn, &id, draft)?;
    Ok(get_entry(conn, &id)?.expect("just inserted"))
}

/// Updates an existing entry in place (order_index untouched, so its
/// position in the hosts file doesn't move).
pub fn update_entry(conn: &Connection, id: &str, draft: &EntryDraft) -> rusqlite::Result<Entry> {
    let ts = now();
    conn.execute(
        "UPDATE entries SET hostname = ?1, comment = ?2, group_name = ?3, enabled = ?4, active_ip_id = ?5, updated_at = ?6
         WHERE id = ?7",
        params![
            draft.hostname.trim(),
            draft.comment,
            draft.group.trim(),
            draft.enabled as i64,
            draft.active_uid,
            ts,
            id
        ],
    )?;
    replace_ip_candidates(conn, id, draft)?;
    Ok(get_entry(conn, id)?.expect("just updated"))
}

pub fn delete_entry(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM ip_candidates WHERE entry_id = ?1", params![id])?;
    conn.execute("DELETE FROM entries WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_active_ip(conn: &Connection, entry_id: &str, ip_id: &str) -> rusqlite::Result<Entry> {
    conn.execute(
        "UPDATE entries SET active_ip_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![ip_id, now(), entry_id],
    )?;
    Ok(get_entry(conn, entry_id)?.expect("entry must exist"))
}

pub fn set_enabled(conn: &Connection, entry_id: &str, enabled: bool) -> rusqlite::Result<Entry> {
    conn.execute(
        "UPDATE entries SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled as i64, now(), entry_id],
    )?;
    Ok(get_entry(conn, entry_id)?.expect("entry must exist"))
}

/// Writes a full historical snapshot back as the current state of its
/// entry id. Used for restoring from history. If the entry no longer
/// exists (e.g. restoring past a since-deleted entry), it's recreated at
/// the end of the ordering with its original id preserved.
pub fn restore_entry_snapshot(conn: &Connection, snapshot: &Entry) -> rusqlite::Result<Entry> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM entries WHERE id = ?1",
            params![snapshot.id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);

    let ts = now();
    if exists {
        conn.execute(
            "UPDATE entries SET hostname = ?1, comment = ?2, group_name = ?3, enabled = ?4, active_ip_id = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                snapshot.hostname,
                snapshot.comment,
                snapshot.group,
                snapshot.enabled as i64,
                snapshot.active_ip_id,
                ts,
                snapshot.id
            ],
        )?;
    } else {
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(order_index), -1) + 1 FROM entries",
            [],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO entries (id, hostname, comment, group_name, enabled, active_ip_id, order_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                snapshot.id,
                snapshot.hostname,
                snapshot.comment,
                snapshot.group,
                snapshot.enabled as i64,
                snapshot.active_ip_id,
                next_order,
                ts
            ],
        )?;
    }

    conn.execute(
        "DELETE FROM ip_candidates WHERE entry_id = ?1",
        params![snapshot.id],
    )?;
    for (idx, ip) in snapshot.ips.iter().enumerate() {
        conn.execute(
            "INSERT INTO ip_candidates (id, entry_id, label, ip, order_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![ip.id, snapshot.id, ip.label, ip.ip, idx as i64, ts],
        )?;
    }

    Ok(get_entry(conn, &snapshot.id)?.expect("just restored"))
}

pub fn insert_history(
    conn: &Connection,
    hostname: &str,
    action: &str,
    entry_id: Option<&str>,
    before: Option<&Entry>,
    after: Option<&Entry>,
    backup_path: Option<&str>,
) -> rusqlite::Result<HistoryEntry> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    let before_json = before.map(|e| serde_json::to_string(e).unwrap());
    let after_json = after.map(|e| serde_json::to_string(e).unwrap());
    conn.execute(
        "INSERT INTO history (id, entry_id, hostname, action, before_json, after_json, backup_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, entry_id, hostname, action, before_json, after_json, backup_path, ts],
    )?;
    Ok(HistoryEntry {
        id,
        time: human_time(&ts),
        hostname: hostname.to_string(),
        action: action.to_string(),
        before: before.cloned(),
        after: after.cloned(),
    })
}

pub fn list_history(conn: &Connection) -> rusqlite::Result<Vec<HistoryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, hostname, action, before_json, after_json, created_at
         FROM history ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let before_json: Option<String> = row.get(3)?;
        let after_json: Option<String> = row.get(4)?;
        Ok(HistoryEntry {
            id: row.get(0)?,
            hostname: row.get(1)?,
            action: row.get(2)?,
            before: before_json.and_then(|j| serde_json::from_str(&j).ok()),
            after: after_json.and_then(|j| serde_json::from_str(&j).ok()),
            time: human_time(&row.get::<_, String>(5)?),
        })
    })?;
    rows.collect()
}

pub fn get_history_entry(conn: &Connection, id: &str) -> rusqlite::Result<Option<HistoryEntry>> {
    conn.query_row(
        "SELECT id, hostname, action, before_json, after_json, created_at FROM history WHERE id = ?1",
        params![id],
        |row| {
            let before_json: Option<String> = row.get(3)?;
            let after_json: Option<String> = row.get(4)?;
            Ok(HistoryEntry {
                id: row.get(0)?,
                hostname: row.get(1)?,
                action: row.get(2)?,
                before: before_json.and_then(|j| serde_json::from_str(&j).ok()),
                after: after_json.and_then(|j| serde_json::from_str(&j).ok()),
                time: human_time(&row.get::<_, String>(5)?),
            })
        },
    )
    .optional()
}

/// If the database has no entries yet but the hosts file already has an
/// app-managed block (e.g. a prior install), imports those lines as
/// entries instead of silently discarding them on first launch.
pub fn seed_from_existing_managed_block(
    conn: &Connection,
    parsed_lines: &[ParsedManagedLine],
) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))?;
    if count > 0 || parsed_lines.is_empty() {
        return Ok(());
    }
    let ts = now();
    for (idx, line) in parsed_lines.iter().enumerate() {
        let entry_id = Uuid::new_v4().to_string();
        let ip_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO entries (id, hostname, comment, group_name, enabled, active_ip_id, order_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?7)",
            params![
                entry_id,
                line.hostname,
                line.comment,
                line.enabled as i64,
                ip_id,
                idx as i64,
                ts
            ],
        )?;
        conn.execute(
            "INSERT INTO ip_candidates (id, entry_id, label, ip, order_index, created_at)
             VALUES (?1, ?2, 'Imported', ?3, 0, ?4)",
            params![ip_id, entry_id, line.ip, ts],
        )?;
    }
    Ok(())
}

/// Deletes history rows beyond the most recent `keep`. `None` leaves
/// history untouched (the "unlimited" Settings option).
pub fn prune_history(conn: &Connection, keep: Option<i64>) -> rusqlite::Result<()> {
    let Some(keep) = keep else { return Ok(()) };
    conn.execute(
        "DELETE FROM history WHERE id NOT IN (
            SELECT id FROM history ORDER BY created_at DESC, rowid DESC LIMIT ?1
        )",
        params![keep],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::IpDraft;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    fn insert_n_history_rows(conn: &Connection, n: usize) {
        for i in 0..n {
            insert_history(conn, &format!("host{i}.test"), "Added entry", None, None, None, None).unwrap();
        }
    }

    #[test]
    fn prune_history_keeps_only_the_most_recent_n() {
        let conn = setup();
        insert_n_history_rows(&conn, 5);

        prune_history(&conn, Some(2)).unwrap();

        let remaining = list_history(&conn).unwrap();
        assert_eq!(remaining.len(), 2);
        // list_history orders by created_at DESC, so the survivors should
        // be the two most recently inserted.
        assert_eq!(remaining[0].hostname, "host4.test");
        assert_eq!(remaining[1].hostname, "host3.test");
    }

    #[test]
    fn prune_history_is_a_noop_when_under_the_limit() {
        let conn = setup();
        insert_n_history_rows(&conn, 3);

        prune_history(&conn, Some(10)).unwrap();

        assert_eq!(list_history(&conn).unwrap().len(), 3);
    }

    #[test]
    fn prune_history_none_keeps_everything() {
        let conn = setup();
        insert_n_history_rows(&conn, 5);

        prune_history(&conn, None).unwrap();

        assert_eq!(list_history(&conn).unwrap().len(), 5);
    }

    #[test]
    fn delete_entry_removes_its_ip_candidates() {
        let conn = setup();
        let draft = EntryDraft {
            id: None,
            hostname: "api.test".to_string(),
            comment: String::new(),
            group: String::new(),
            enabled: true,
            active_uid: "ip1".to_string(),
            ips: vec![IpDraft { uid: "ip1".to_string(), label: "primary".to_string(), ip: "127.0.0.1".to_string() }],
        };
        let entry = insert_entry(&conn, &draft).unwrap();

        delete_entry(&conn, &entry.id).unwrap();

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM ip_candidates", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}
