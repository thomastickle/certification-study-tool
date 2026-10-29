import type { SessionUser } from '../../shared/auth-contracts.ts'
import type { LibraryRepository } from '../questions/library-repository.ts'
import type { PrivateLibraries } from '../questions/private-libraries.ts'
import type { StudyHousekeeping } from '../questions/study-housekeeping.ts'

/** Own personal connections for the full asynchronous operation, independently of HTTP response life. */
export class StudyLibraryScope {
  private libraries: Pick<PrivateLibraries, 'open'>
  private housekeeping: Pick<StudyHousekeeping, 'observeRequest'>

  constructor(
    libraries: Pick<PrivateLibraries, 'open'>,
    housekeeping: Pick<StudyHousekeeping, 'observeRequest'>,
  ) {
    this.libraries = libraries
    this.housekeeping = housekeeping
  }

  /** Use only the actor established by authentication, never an account selector from request input.
   * @throws Propagates opening, work, and observation failures after releasing the connection.
   */
  async withLibrary<T>(
    verifiedSessionUser: SessionUser,
    method: string | undefined,
    work: (personal: LibraryRepository) => Promise<T>,
  ): Promise<T> {
    const personal = this.libraries.open(verifiedSessionUser.id)
    try {
      return await work(personal)
    } finally {
      try {
        this.housekeeping.observeRequest(method, verifiedSessionUser.id, personal)
      } finally {
        personal.close()
      }
    }
  }
}
