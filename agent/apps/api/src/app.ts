import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Pool } from '@arrive/database';
import type { ApiErrorBody } from '@arrive/shared';
import { noAuthentication, type Authenticator } from './auth.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { registerRoutes } from './routes/index.js';

export interface AppDeps {
  config: Config;
  pool: Pool;
  authenticate?: Authenticator;
  clock?: () => Date;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
const MAX_MB_HARD_CAP = 100;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, pool } = deps;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], remove: true },
    },
    // Trust a caller-supplied id only if it is well formed (it ends up in logs and the audit trail).
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQUEST_ID_RE.test(h) ? h : randomUUID();
    },
  });

  await app.register(multipart, {
    limits: { fileSize: MAX_MB_HARD_CAP * 1024 * 1024, files: 1, fields: 10, parts: 12 },
    throwFileSizeLimit: false,
  });

  app.decorateRequest('actor', undefined as never);
  const authenticate = deps.authenticate ?? noAuthentication;
  app.addHook('onRequest', async (req) => {
    req.actor = await authenticate(req);
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    const send = (status: number, code: string, message: string, details?: unknown) => {
      const body: ApiErrorBody = { error: { code, message, details, requestId: req.id } };
      return reply.status(status).send(body);
    };
    if (err instanceof AppError) return send(err.statusCode, err.code, err.message, err.details);
    if (err instanceof ZodError) {
      return send(400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة.', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) return send(fe.statusCode, fe.code ?? 'BAD_REQUEST', 'طلب غير صالح.');
    req.log.error({ err }, 'unhandled error');
    return send(500, 'INTERNAL_ERROR', 'حدث خطأ داخلي.');
  });
  app.setNotFoundHandler((req, reply) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'المسار غير موجود.', requestId: req.id } };
    return reply.status(404).send(body);
  });

  registerRoutes(app, { config, pool, clock: deps.clock ?? (() => new Date()) });
  return app;
}
