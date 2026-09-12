#!/usr/bin/env node
/**
 * CLI runner / alias for ID migration script.
 * Forwards to server/migrate-ids.mjs.
 */
export * from '../server/migrate-ids.mjs';
import('../server/migrate-ids.mjs');
