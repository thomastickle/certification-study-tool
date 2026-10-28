import { Module } from '@nestjs/common'
import { HomeController } from './home.controller.ts'
import { StudyController } from './study.controller.ts'
import { QuizPathGuard } from './quiz-path.guard.ts'

@Module({ controllers: [HomeController, StudyController], providers: [QuizPathGuard] })
export class StudyHttpModule {}
