// The admin CRUD kit (docs/cloudflare/admin-crud.md). Plain functions, one
// concern per file; `crudRoutes` is built from them, and a route that does not
// fit it is written by hand from the same functions.
export { changedFields, withAudit, auditMetadata, MAX_LABEL_LENGTH, type AuditNote } from "./audit";
export { etagOf, matches, nextVersion, parseEtag, readIfMatch, type IfMatch } from "./concurrency";
export {
  conflict,
  fail,
  inUse,
  invalidJson,
  invalidQuery,
  isForeignKeyViolation,
  isUniqueViolation,
  jsonRequired,
  notFound,
  preconditionRequired,
  stale,
  tooLarge,
  validationError,
  type ErrorBody,
} from "./errors";
export {
  booleanFilter,
  DEFAULT_PAGE_SIZE,
  enumFilter,
  escapeLike,
  likeContains,
  likePattern,
  MAX_LIKE_PATTERN_BYTES,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  pageOf,
  parseListQuery,
  parsePage,
  parseSearch,
  parseSort,
  reader,
  type Filter,
  type ListEnvelope,
  type ListQuery,
  type ListSpec,
  type PageRequest,
  type QueryReader,
} from "./pagination";
export { crudHandlers, crudRoutes, type CrudDeps, type ResourceConfig } from "./resource";
export { DEFAULT_MAX_BODY_BYTES, fieldsOf, isAllowedFilePath, parseBody, uploadPath } from "./validation";
