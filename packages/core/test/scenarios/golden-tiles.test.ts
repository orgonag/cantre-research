import { describe } from 'vitest';
import { scenarios } from './golden-tiles.scenarios.js';
import { runScenarios } from './harness.js';

describe('scenario: golden tiles', () => {
  runScenarios(scenarios);
});
