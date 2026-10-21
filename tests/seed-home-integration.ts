import './seed-certifications.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { homeExam, homeNow } from './home-fixtures.ts'

// The imported seed refuses existing paths and creates only synthetic banks.
const repository = new LibraryRepository(process.argv[2]!)
try {
  const exam = homeExam('00000000-0000-4000-8000-000000000099', 10)
  const offset = Date.now() - homeNow
  exam.options = { ...exam.options, provider: 'AWS', certification: 'DEA-C01' }
  exam.questions.forEach((question) => {
    question.domain = 0
  })
  exam.startedAt += offset
  exam.deadline += offset
  exam.finishedAt! += offset
  exam.serverNow += offset
  repository.quizStore().save(exam)
} finally {
  repository.close()
}
