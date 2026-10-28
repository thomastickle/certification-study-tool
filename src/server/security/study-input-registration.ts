import type { PipeTransform, Type } from '@nestjs/common'
import type { CustomParamFactory } from '@nestjs/common/interfaces/features/custom-route-param-factory.interface'
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum'
import {
  CUSTOM_ROUTE_ARGS_METADATA,
  PARAMTYPES_METADATA,
  PIPES_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants'
import { DiscoveryService, MetadataScanner } from '@nestjs/core'
import type { AdmittedRequest } from './security-context.ts'
import { JOINED_STUDY_INPUTS } from './security-context.ts'

const OWNED_FACTORY = Symbol('OwnedStudyInputFactory')

export const STUDY_INPUTS_REGISTERED = Symbol('StudyInputsRegistered')

type Parameter = {
  index: number
  factory?: CustomParamFactory<unknown, unknown>
  data?: unknown
  pipes?: PipeTransform[]
  schema?: unknown
}

/** Adapt explicitly joined custom parameters before Nest snapshots execution metadata.
 * Each factory and its parameter-local instance pipes become one awaited input operation.
 * @throws {Error} For inputs/pipes outside the optional joined-input adapter's supported contract.
 */
export function registerStudyInputs(discovery: DiscoveryService): boolean {
  let registeredAny = false
  const providers = discovery.getProviders()
  const modules = new Set(providers.map((provider) => provider.host))
  const scanner = new MetadataScanner()
  for (const controller of discovery.getControllers()) {
    const type = controller.metatype as Type<object>
    if (!type) {
      continue
    }
    const prototype = type.prototype as Record<string, unknown>
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name] as (...args: unknown[]) => unknown
      const scoped =
        Reflect.getMetadata(JOINED_STUDY_INPUTS, handler) ??
        Reflect.getMetadata(JOINED_STUDY_INPUTS, type)
      if (!scoped) {
        continue
      }
      // Nest's discovered pipe enhancers include APP_PIPE (also request-scoped) and class pipes.
      // Instance pipes on a parameter have no separate enhancer provider and are owned below.
      for (const module of modules) {
        const enhancers = [
          ...(module?.providers.values() ?? []),
          ...(module?.injectables.values() ?? []),
        ]
        if (enhancers.some((provider) => provider.subtype === 'pipe')) {
          throw new Error(
            'Use parameter-local pipe instances on study inputs; global and class pipes are not supported.',
          )
        }
      }
      registeredAny = true
      const pipes = [
        ...(Reflect.getMetadata(PIPES_METADATA, type) ?? []),
        ...(Reflect.getMetadata(PIPES_METADATA, handler) ?? []),
      ]
      if (pipes.length) {
        throw new Error('StudyRequest requires parameter-local pipe instances, not @UsePipes().')
      }
      const parameters = Reflect.getMetadata(ROUTE_ARGS_METADATA, type, name) as
        Record<string, Parameter> | undefined
      const owned = { ...parameters }
      const types = Reflect.getMetadata(PARAMTYPES_METADATA, prototype, name) as
        Type<unknown>[] | undefined
      for (const [key, registered] of Object.entries(owned)) {
        if (!key.includes(CUSTOM_ROUTE_ARGS_METADATA)) {
          const kind = Number(key.split(':')[0])
          if (
            ![RouteParamtypes.REQUEST, RouteParamtypes.RESPONSE, RouteParamtypes.NEXT].includes(
              kind,
            )
          ) {
            throw new Error(
              'StudyRequest inputs require custom decorators (NormalizedUrl/Query, JsonObjectBody or a custom study factory).',
            )
          }
          continue
        }
        // Inherited metadata may already be owned by another concrete controller. Rebuild
        // from its original input so this handler supplies its own emitted parameter types.
        const original = Reflect.getMetadata(OWNED_FACTORY, registered.factory!) as
          Parameter | undefined
        const parameter = original ?? registered
        const factory = parameter.factory!
        const inputPipes = parameter.pipes ?? []
        if (
          parameter.schema ||
          inputPipes.some(
            (pipe) => typeof pipe !== 'object' || typeof pipe?.transform !== 'function',
          )
        ) {
          throw new Error(
            'Study inputs support parameter-local pipe instances; validate domain DTOs in services.',
          )
        }

        const ownedFactory: CustomParamFactory<unknown, unknown> = (data, context) => {
          const request = context.switchToHttp().getRequest<AdmittedRequest>()
          if (!request.inputWork) {
            throw new Error('Study input ownership requires createApplication and @StudyRequest().')
          }
          return request.inputWork.run(async () => {
            let value = await factory(data, context)
            const metadata = {
              type: 'custom' as const,
              data: data as string | undefined,
              metatype: types?.[parameter.index],
            }
            for (const pipe of inputPipes) {
              value = await pipe.transform(value, metadata)
            }
            return value
          })
        }

        Reflect.defineMetadata(OWNED_FACTORY, parameter, ownedFactory)
        owned[key] = { ...parameter, factory: ownedFactory, pipes: [] }
      }
      Reflect.defineMetadata(ROUTE_ARGS_METADATA, owned, type, name)
      Reflect.defineMetadata(STUDY_INPUTS_REGISTERED, true, handler)
    }
  }
  return registeredAny
}
