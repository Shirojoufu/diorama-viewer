// npm test: Node's built-in test runner, spec output to the terminal and JUnit XML to
// $JUNIT_FILE (default reports/junit/unit.xml) for CI and the flaky test detector.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const junit = process.env.JUNIT_FILE || 'reports/junit/unit.xml';
mkdirSync(dirname(junit), { recursive: true });
const { status } = spawnSync(process.execPath, [
  '--test',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=junit', `--test-reporter-destination=${junit}`,
  'tests/unit/*.test.mjs',
], { stdio: 'inherit' });
process.exit(status ?? 1);
