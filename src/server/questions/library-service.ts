import { ApplicationError } from '../errors.ts';
import { LibraryRepository } from './library-repository.ts';
export class LibraryService {
  private repository: LibraryRepository;
  constructor(repository: LibraryRepository) { this.repository = repository; }
  deleteQuestion(id: number): void {
    this.repository.transaction(() => {
      if (!this.repository.deleteQuestion(id)) throw new ApplicationError('Question not found.', 404);
    });
  }
  deleteSource(id: number): void {
    this.repository.transaction(() => {
      if (!this.repository.deleteSource(id)) throw new ApplicationError('Source not found.', 404);
    });
  }
}
