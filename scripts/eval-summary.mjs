import { readFileSync } from 'node:fs';
const reportPath = process.argv[2] ?? 'output/eval-live.json';
let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  console.error(`Cannot read ${reportPath}. Run pnpm eval first, or pass another report path.`);
  process.exit(1);
}
const groups = new Map();
for (const row of report.results.results) {
  const id = row.provider.label || row.provider.id;
  const group = groups.get(id) ?? [];
  group.push(row);
  groups.set(id, group);
}
for (const [model, rows] of groups) {
  const latencies = rows
    .map((row) => row.latencyMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const percentile = (fraction) =>
    latencies.length
      ? `${(latencies[Math.max(0, Math.ceil(latencies.length * fraction) - 1)] / 1000).toFixed(2)}s`
      : 'unknown';
  const knownCosts = rows.map((row) => row.response?.cost).filter(Number.isFinite);
  const cost = knownCosts.length
    ? `$${knownCosts.reduce((sum, value) => sum + value, 0).toFixed(6)}${knownCosts.length < rows.length ? ' (partial)' : ''}`
    : 'not reported';
  console.log(
    `${model}: ${rows.filter((row) => row.success).length}/${rows.length} passed; p50 ${percentile(0.5)}; p95 ${percentile(0.95)}; reported cost ${cost}`,
  );
  for (const row of rows.filter((item) => !item.success))
    console.log(`  Failed: ${row.testCase.description}`);
}
