import { ZYGOS_USERS } from '../zygos-helpers.js';

export const ROLES = [
  { label: 'Admin', user: ZYGOS_USERS.ADMIN },
  { label: 'User', user: ZYGOS_USERS.MAKER_A },
] as const;
