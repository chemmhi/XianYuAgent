import test from 'node:test';
import { verificationTransportScenario } from './verification-transport-scenario.js';
test('real HTTP/WS/Chrome: retry enters original native recovery, grants one connection and completes business liveness', () => verificationTransportScenario());
test('real HTTP/WS/Chrome native iframe: 12x35ms drag reaches original token CAS and matched heartbeat', () => verificationTransportScenario(undefined, true));
test('real HTTP/WS/Chrome: native 300 remains manual, original refresh allows code0 and verified business liveness in the same window', () => verificationTransportScenario(undefined, true, true));
test('real HTTP/WS/Chrome: 600ms hold and continuous 3s native drag consume fresh streamed frames while pixels keep advancing', () => verificationTransportScenario(undefined, true, false, true));
test('real HTTP/WS/Chrome: a 75ms service cannot sustain blind 33ms input and the bounded queue refuses overflow safely', () => verificationTransportScenario(undefined, true, false, false, 75));
