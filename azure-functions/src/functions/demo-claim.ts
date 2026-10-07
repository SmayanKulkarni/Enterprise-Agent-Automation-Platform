import * as df from 'durable-functions';
import type { InvocationContext } from '@azure/functions';

df.app.orchestration('demoClaim', function* () { return true; });

const NOT_FOUND = 'HTTP 404';

export function durableDemoClaims(context: InvocationContext) {
  const client = df.getClient(context);
  const instanceId = (key: string): string => `demo-${key}`;
  const claimed = async (key: string): Promise<boolean> => {
    try { await client.getStatus(instanceId(key)); return true; } catch (error) {
      if (error instanceof Error && error.message.includes(NOT_FOUND)) return false;
      throw error;
    }
  };
  return {
    claimed,
    async claim(key: string): Promise<boolean> {
      if (await claimed(key)) return false;
      try { await client.startNew('demoClaim', { instanceId: instanceId(key) }); return true; } catch (error) {
        if (await claimed(key)) return false;
        throw error;
      }
    },
  };
}
