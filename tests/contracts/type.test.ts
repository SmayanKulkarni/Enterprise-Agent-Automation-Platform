import { expectTypeOf, test } from 'vitest';

import { messageId, tenantId } from '../../packages/contracts/src/index.js';

test('opaque identifiers cannot substitute for each other', () => {
  const tenant = tenantId('22222222-2222-4222-8222-222222222222');
  // @ts-expect-error Tenant IDs are not message IDs.
  const invalid: ReturnType<typeof messageId> = tenant;
  expectTypeOf(invalid).toEqualTypeOf<ReturnType<typeof messageId>>();
});
