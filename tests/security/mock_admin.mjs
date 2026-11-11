export const supabaseAdmin = { rpc: async (name, args) => { globalThis.__f.rpcCalls.push({ name, args }); return { error: globalThis.__f.rpcError ?? null }; } };
