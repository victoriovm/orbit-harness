import type { FiberState } from '@deepseek-ai/cordis'

/**
 * Runtime mirrors of cordis's `FiberState` const enum.
 *
 * A `const enum` has no runtime object to import: TypeScript inlines its
 * members at compile time, and bundlers resolving across packages cannot
 * inline it either, so importing it as a value leaves a bare import the
 * packaged application cannot resolve (ERR_MODULE_NOT_FOUND /
 * "does not provide an export"). These mirrors keep the vendored numeric
 * values while retaining the enum member types.
 */
export const FIBER_STATE_ACTIVE = 2 as FiberState.ACTIVE
export const FIBER_STATE_UNLOADING = 5 as FiberState.UNLOADING
