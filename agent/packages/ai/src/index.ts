/**
 * Placeholder for Phase 5 (AI Audit Assistant).
 *
 * Intentionally empty in Phase 2. Architectural contract for the future module:
 *  - the LLM never computes figures; it only explains results produced by @arrive/engine / the rules engine;
 *  - it reaches data exclusively through read-only tool calls;
 *  - provider access sits behind a configurable adapter, and API keys stay server-side.
 */
export const AI_MODULE_STATUS = 'NOT_IMPLEMENTED_PHASE_2' as const;
