/**
 * The four HTTP statuses the Kefi E2E write/cleanup paths branch on. ONE
 * definition: `kefiEventOpsFixture` declared HTTP_OK/HTTP_CREATED but still
 * compared raw 204/404, and `kefiEventOpsLeaks` re-declared its own pair.
 */
export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_NO_CONTENT = 204;
export const HTTP_NOT_FOUND = 404;
