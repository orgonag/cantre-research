import { describe } from 'vitest';
import { scenarios } from './coverage.scenarios.js';
import { runScenarios } from './harness.js';

describe('scenario: coverage', () => {
  runScenarios(scenarios);
});
