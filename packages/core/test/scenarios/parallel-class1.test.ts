import { describe } from 'vitest';
import { scenarios } from './parallel-class1.scenarios.js';
import { runScenarios } from './harness.js';

describe('scenario: parallel-class1', () => {
  runScenarios(scenarios);
});
