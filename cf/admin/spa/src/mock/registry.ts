import type { AnyMockResource } from "./resources";

// MOCK, local development only. Every file in `mock/resources/` that `export default`s a `MockResource` (or an
// array of them) is a mocked resource: add a file to mock one more, nothing to edit here. See mock/resources.ts.

const modules = import.meta.glob<{ default: AnyMockResource | readonly AnyMockResource[] }>("./resources/*.ts", { eager: true });

export const MOCK_RESOURCES: readonly AnyMockResource[] = Object.values(modules).flatMap((module) => (Array.isArray(module.default) ? module.default : [module.default as AnyMockResource]));
