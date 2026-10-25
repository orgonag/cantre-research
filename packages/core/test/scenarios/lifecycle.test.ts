import { describe } from 'vitest';
import { scenarios } from './lifecycle.scenarios.js';
import { runScenarios } from './harness.js';

describe('scenario: lifecycle', () => {
  runScenarios(scenarios);
});
