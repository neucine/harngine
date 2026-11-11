import { randomBytes } from 'node:crypto';

export function entityId<Prefix extends string>(prefix: Prefix): `${Prefix}_${string}` {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}
