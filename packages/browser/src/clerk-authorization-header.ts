/** Browser-safe Clerk session-token header; verification remains server-only. */
export async function clerkAuthorizationHeader(getToken: () => Promise<string | null>): Promise<Record<'authorization', string>> {
  const token = await getToken();
  if (!token) throw new Error('DENIED');
  return { authorization: `Bearer ${token}` };
}
