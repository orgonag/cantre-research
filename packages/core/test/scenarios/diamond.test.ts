import { describe } from 'vitest';
import { scenarios } from './diamond.scenarios.js';
import { runScenarios } from './harness.js';

describe('scenario: diamond', () => {
  runScenarios(scenarios);
});
