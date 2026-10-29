import { RuntimeStartup } from './runtime-startup.ts'
import { Module } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'
import { ApplicationRuntime } from './application-runtime.ts'
import { ApplicationAuthentication } from '../auth/application-authentication.ts'
import { ImportPreviews } from '../importer/import-previews.ts'
import { PrivateLibraries } from '../questions/private-libraries.ts'
import { StudyHousekeeping } from '../questions/study-housekeeping.ts'
import { StudyLibraryScope } from './study-library-scope.ts'
import { RUNTIME_CONFIGURATION } from './runtime-configuration.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'

export const SHARED_LIBRARY_REPOSITORY = Symbol('SharedLibraryRepository')

/** Register one explicitly configured graph; no environment reads or I/O occur during import. */
@Module({})
export class RuntimeModule {
  static register(
    configuration: RuntimeConfiguration,
    startup = new RuntimeStartup(),
  ): DynamicModule {
    const aliases = [
      {
        provide: ApplicationAuthentication,
        select: (runtime: ApplicationRuntime) => runtime.authentication,
      },
      {
        provide: SHARED_LIBRARY_REPOSITORY,
        select: (runtime: ApplicationRuntime) => runtime.sharedLibrary,
      },
      { provide: ImportPreviews, select: (runtime: ApplicationRuntime) => runtime.previews },
      {
        provide: PrivateLibraries,
        select: (runtime: ApplicationRuntime) => runtime.privateLibraries,
      },
      { provide: StudyHousekeeping, select: (runtime: ApplicationRuntime) => runtime.housekeeping },
      {
        provide: StudyLibraryScope,
        select: (runtime: ApplicationRuntime) => runtime.studyLibraries,
      },
    ]
    return {
      module: RuntimeModule,
      global: true,
      providers: [
        { provide: RUNTIME_CONFIGURATION, useValue: configuration },
        {
          provide: ApplicationRuntime,
          useFactory: (config: RuntimeConfiguration) => startup.acquire(config),
          inject: [RUNTIME_CONFIGURATION],
        },
        ...aliases.map(({ provide, select }) => ({
          provide,
          useFactory: select,
          inject: [ApplicationRuntime],
        })),
      ],
      exports: [
        RUNTIME_CONFIGURATION,
        ApplicationRuntime,
        ...aliases.map(({ provide }) => provide),
      ],
    }
  }
}
