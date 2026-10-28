import { JsonBodyInterceptor } from '../security/json-body.interceptor.ts'
import { ExpireEarnedInterceptor } from './expire-earned.interceptor.ts'
import { Module } from '@nestjs/common'
import { HomeController } from './home.controller.ts'
import { QuizController } from './quiz.controller.ts'
import { QuizHistoryController } from './quiz-history.controller.ts'
import { ReportsController } from './reports.controller.ts'
import { QuizPathGuard } from './quiz-path.guard.ts'

@Module({
  controllers: [HomeController, QuizHistoryController, QuizController, ReportsController],
  providers: [JsonBodyInterceptor, QuizPathGuard, ExpireEarnedInterceptor],
})
export class StudyHttpModule {}
