import type { FastifyRequest } from 'fastify';

export interface Actor {
  id: string | null;
  label: string;
  role: 'admin' | 'audit_manager' | 'auditor' | 'viewer';
}

/** Resolves who is calling. Phase 8 replaces this with real token/session verification and RBAC checks. */
export type Authenticator = (req: FastifyRequest) => Promise<Actor>;

export const noAuthentication: Authenticator = async () => ({ id: null, label: 'local-operator', role: 'admin' });

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}
