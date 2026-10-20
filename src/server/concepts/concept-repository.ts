import type { DatabaseSync } from 'node:sqlite'
import type { ConceptScope } from '../../shared/concept-contracts.ts'

export type ReviewedConcept = ConceptScope & { id: string; name: string; identities: string[] }

/** Add independently versioned concept metadata without rewriting library or quiz tables. */
export function migrateConcepts(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS concept_schema (version INTEGER PRIMARY KEY CHECK (version = 1));
    INSERT OR IGNORE INTO concept_schema VALUES (1);
    CREATE TABLE IF NOT EXISTS reviewed_concepts (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, certification TEXT NOT NULL,
      name TEXT NOT NULL, normalized_name TEXT NOT NULL, identities TEXT NOT NULL,
      UNIQUE(provider, certification, normalized_name)
    );
    CREATE TABLE IF NOT EXISTS dismissed_concept_suggestions (id TEXT PRIMARY KEY);
    COMMIT;`)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Store reviewed mappings separately from immutable source content and saved attempts. */
export class ConceptRepository {
  private db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  all(): ReviewedConcept[] {
    return this.db
      .prepare(
        'SELECT id, provider, certification, name, identities FROM reviewed_concepts ORDER BY name, id',
      )
      .all()
      .map((row) => ({
        ...row,
        identities: JSON.parse(String(row.identities)),
      })) as ReviewedConcept[]
  }

  save(group: ReviewedConcept): void {
    this.db
      .prepare(
        `INSERT INTO reviewed_concepts VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, normalized_name=excluded.normalized_name, identities=excluded.identities`,
      )
      .run(
        group.id,
        group.provider,
        group.certification,
        group.name,
        group.name.toLocaleLowerCase('en-US'),
        JSON.stringify(group.identities),
      )
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM reviewed_concepts WHERE id = ?').run(id).changes === 1
  }

  dismissed(): Set<string> {
    return new Set(
      this.db
        .prepare('SELECT id FROM dismissed_concept_suggestions')
        .all()
        .map((row) => String(row.id)),
    )
  }

  dismiss(id: string): void {
    this.db.prepare('INSERT OR IGNORE INTO dismissed_concept_suggestions VALUES (?)').run(id)
  }
}
