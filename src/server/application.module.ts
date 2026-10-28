import type { DynamicModule } from '@nestjs/common'
import { RuntimeModule, RuntimeStartup } from './runtime.module.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'
import { Module } from '@nestjs/common'
import { SecurityModule } from './security.module.ts'

/** Configure one global runtime for security and all selected feature controllers. */
@Module({})
export class ApplicationModule {
  /** Share the same configured providers when feature controllers replace the legacy transport. */
  static register(
    configuration: RuntimeConfiguration,
    features: DynamicModule['imports'] = [],
    startup = new RuntimeStartup(),
  ): DynamicModule {
    return {
      module: ApplicationModule,
      imports: [RuntimeModule.register(configuration, startup), SecurityModule, ...features],
    }
  }
}
