import { describe } from 'vitest';
import { scenarios } from './double-track.scenarios.js';
import { runScenarios } from './harness.js';

describe('scenario: double-track', () => {
  runScenarios(scenarios);
});
