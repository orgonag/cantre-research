import { describe } from 'vitest';
import { scenarios } from './junction.scenarios.js';
import { runScenarios } from './harness.js';

describe('scenario: junction', () => {
  runScenarios(scenarios);
});
