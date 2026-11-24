# Flaky test report

**Runs analysed:** 4 (4 on main, 0 from pull requests) · **Tests tracked:** 131 · **Flaky:** 0 (🔴 0 critical, 🟠 0 high, 🟡 0 medium, ⚪ 0 low) · **Consistently failing:** 0 · **Fixed flakes:** 0

## This run

main · commit `90e9544` · Give the browser tests a smaller viewport and longer timeouts on CI

All 9 tests passed.

## Flaky tests

No flaky tests detected: no test has both passed and failed on the same code.

## Trends

```mermaid
xychart-beta
    title "First-attempt pass rate (%), last 4 runs"
    x-axis "Run" [1, 2, 3, 4]
    y-axis "Pass rate" 0 --> 100
    line [100.0, 55.56, 100.0, 100.0]
```

```mermaid
xychart-beta
    title "Flaky failures per run, last 4 runs"
    x-axis "Run" [1, 2, 3, 4]
    y-axis "Flaky failures" 0 --> 1
    bar [0, 0, 0, 0]
```

<details><summary>Run key</summary>

| Run | Commit | Where | Date |
| --- | --- | --- | --- |
| 1 | `ca5a8af` | main | 2026-11-24 |
| 2 | `ca5a8af` | main | 2026-11-24 |
| 3 | `90e9544` | main | 2026-11-24 |
| 4 | `90e9544` | main | 2026-11-24 |

</details>

## Coverage

No coverage data. Run pytest with `--cov --cov-context=test --cov-report=json`.

## Graph data

- `runs.csv`: one row per run: pass rate, failures, flaky failures, coverage, diff coverage
- `runs.json`: same as runs.csv, as JSON
- `test_outcomes.csv`: every test attempt in every run (long format, for heatmaps)
- `flaky_tests.json`: flaky and failing tests with stats, onset and per-run timeline
- `coverage_files.csv`: per-file coverage for the latest run with coverage
- `coverage_gaps.json`: files below threshold, never-executed files, uncovered changed lines
