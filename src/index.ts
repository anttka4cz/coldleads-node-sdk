export { ColdLeads, verifyCallbackSignature, VerifyResource, FindResource, LeadsResource, CreditsResource, AgentResource, CrmResource, type ColdLeadsOptions } from "./client.js";
export {
  ColdLeadsError,
  AuthenticationError,
  PermissionError,
  InsufficientCreditsError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ConnectionError,
  TimeoutError,
  type ErrorBody,
} from "./errors.js";
export { VERSION, DEFAULT_BASE_URL, isColdLeadsError, type FetchLike, type RequestOptions } from "./http.js";
export type * from "./types.js";
export { ColdLeads as default } from "./client.js";
