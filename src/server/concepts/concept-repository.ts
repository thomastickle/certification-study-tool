import type { DatabaseSync } from 'node:sqlite'
import type { ConceptScope } from '../../shared/concept-contracts.ts'

export type ReviewedConcept = ConceptScope & { id: string; name: string; identities: string[] }

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
