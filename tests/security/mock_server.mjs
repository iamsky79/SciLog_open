export async function createClient() {
  const f = globalThis.__f;
  return { auth: { getUser: async () => ({ data: { user: f.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: f.requesterRow }) }) }) }) };
}
