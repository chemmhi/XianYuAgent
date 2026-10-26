import test from 'node:test';
import { verificationTransportScenario } from './verification-transport-scenario.js';
const url = process.env.MANUAL_VERIFICATION_TEST_DATABASE_URL;
if (!url) throw new Error('isolated MANUAL_VERIFICATION_TEST_DATABASE_URL required');
test('real PostgreSQL/HTTP/WS/Chrome: manual recovery persists state, credential CAS and actual platform heartbeat', () => verificationTransportScenario(url));
test('real PostgreSQL/HTTP/WS/Chrome native iframe: continuous drag persists actual token CAS and matched heartbeat', () => verificationTransportScenario(url, true));
test('real PostgreSQL/HTTP/WS/Chrome: rejected native answer, original refresh and code0 persist in one human window', () => verificationTransportScenario(url, true, true));
