import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, stddev, weightedScore, computeResults, resultsToCsv } from './compute.js';

const approx = (actual, expected, msg) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ''} expected ${expected}, got ${actual}`);
};

/* Minimal competition: 1 category, 1 panel, 2 criteria at 50/50. */
function fixture({ scores, judges }) {
  return {
    categories: [{ id: 1, name: 'Cat A', position: 1, voting_locked: 0 }],
    criteria: [
      { id: 1, name: 'C1', position: 1 },
      { id: 2, name: 'C2', position: 2 },
    ],
    weights: [
      { category_id: 1, criterion_id: 1, weight: 0.5 },
      { category_id: 1, criterion_id: 2, weight: 0.5 },
    ],
    panels: [{ id: 1, name: 'Panel 1', category_id: 1 }],
    judges,
    entries: [
      { id: 1, category_id: 1, name: 'E1', description: '', position: 1 },
      { id: 2, category_id: 1, name: 'E2', description: '', position: 2 },
      { id: 3, category_id: 1, name: 'E3', description: '', position: 3 },
    ],
    scores,
  };
}

const J = (id, name) => ({ id, employee_id: `EMP${id}`, name, panel_id: 1, role: 'judge' });
const S = (judge, entry, criterion, score) => ({ judge_id: judge, entry_id: entry, criterion_id: criterion, score });

test('stddev is population stddev (STANDARDIZE cross-check)', () => {
  // Hand-computed: values 4.2, 3.0, 2.4, 4.8 → mean 3.6, population sd 0.9486833
  const vals = [4.2, 3.0, 2.4, 4.8];
  approx(mean(vals), 3.6);
  approx(stddev(vals), Math.sqrt(0.9));
  // STANDARDIZE(4.2, 3.6, 0.9486832981) = 0.6324555320
  approx((4.2 - mean(vals)) / stddev(vals), 0.6 / Math.sqrt(0.9));
});

test('weightedScore normalizes weights and requires all criteria', () => {
  // Raw percent-style weights 40/10 → effective 0.8/0.2
  approx(weightedScore({ 1: 5, 2: 1 }, { 1: 40, 2: 10 }, [1, 2]), 4.2);
  // Missing a criterion → incomplete → null
  assert.equal(weightedScore({ 1: 5 }, { 1: 40, 2: 10 }, [1, 2]), null);
});

test('z-scores, sd=0 fallback, normalized averaging, ranking', () => {
  const data = fixture({
    judges: [J(1, 'Harsh Range'), J(2, 'Flatliner')],
    scores: [
      // Judge 1 uses a range: weighted 4, 2, 3 → mean 3, sd sqrt(2/3)
      S(1, 1, 1, 4), S(1, 1, 2, 4),
      S(1, 2, 1, 2), S(1, 2, 2, 2),
      S(1, 3, 1, 3), S(1, 3, 2, 3),
      // Judge 2 scores everything identically → sd 0 → all z = 0
      S(2, 1, 1, 3), S(2, 1, 2, 3),
      S(2, 2, 1, 3), S(2, 2, 2, 3),
      S(2, 3, 1, 3), S(2, 3, 2, 3),
    ],
  });
  const [cat] = computeResults(data);

  const sd1 = Math.sqrt(2 / 3);
  const byName = Object.fromEntries(cat.entries.map((e) => [e.name, e]));

  const j1 = cat.judges.find((j) => j.id === 1);
  approx(j1.mean, 3);
  approx(j1.sd, sd1);

  // Judge 1 z-scores: (4−3)/sd, (2−3)/sd, 0. Judge 2: sd=0 → z=0 everywhere.
  approx(byName.E1.perJudge.find((p) => p.judgeId === 1).z, 1 / sd1);
  approx(byName.E1.perJudge.find((p) => p.judgeId === 2).z, 0);

  // Entry normalized = mean of judge z-scores.
  approx(byName.E1.normalized, 1 / sd1 / 2);
  approx(byName.E2.normalized, -1 / sd1 / 2);
  approx(byName.E3.normalized, 0);

  assert.deepEqual(cat.entries.map((e) => e.name), ['E1', 'E3', 'E2']);
  assert.deepEqual(cat.entries.map((e) => e.rank), [1, 2, 3]);

  approx(byName.E1.avgWeighted, 3.5);
  approx(byName.E1.spread.min, 3);
  approx(byName.E1.spread.max, 4);
});

test('partial ballots are excluded from stats and flagged', () => {
  const data = fixture({
    judges: [J(1, 'Complete'), J(2, 'Partial')],
    scores: [
      S(1, 1, 1, 4), S(1, 1, 2, 4),
      S(1, 2, 1, 2), S(1, 2, 2, 2),
      S(1, 3, 1, 3), S(1, 3, 2, 3),
      S(2, 1, 1, 5), S(2, 1, 2, 5),
      S(2, 2, 1, 4), // only 1 of 2 criteria → incomplete for E2
    ],
  });
  const [cat] = computeResults(data);
  const byName = Object.fromEntries(cat.entries.map((e) => [e.name, e]));

  const j2 = cat.judges.find((j) => j.id === 2);
  assert.equal(j2.scoredCount, 1);
  assert.equal(byName.E2.judgesScored, 1);
  assert.equal(byName.E2.perJudge.find((p) => p.judgeId === 2).weighted, null);
  // Judge 2's only complete entry: sd 0 → z 0, doesn't skew E1.
  approx(byName.E1.perJudge.find((p) => p.judgeId === 2).z, 0);
});

test('tiebreak on normalized uses average weighted score', () => {
  const data = fixture({
    judges: [J(1, 'Flat'), J(2, 'Solo')],
    scores: [
      // Judge 1: identical everywhere → z 0 for E1 and E2
      S(1, 1, 1, 4), S(1, 1, 2, 4),
      S(1, 2, 1, 4), S(1, 2, 2, 4),
      // Judge 2 only scored E1 (single entry → sd 0 → z 0)
      S(2, 1, 1, 5), S(2, 1, 2, 5),
    ],
  });
  const [cat] = computeResults(data);
  const [first, second] = cat.entries;
  approx(first.normalized, 0);
  approx(second.normalized, 0);
  // Tied at 0 normalized; E1 avgWeighted 4.5 beats E2's 4.0.
  assert.equal(first.name, 'E1');
  assert.equal(second.name, 'E2');
});

test('entries with no complete scores rank last with null rank', () => {
  const data = fixture({
    judges: [J(1, 'Only One')],
    scores: [S(1, 1, 1, 4), S(1, 1, 2, 4)],
  });
  const [cat] = computeResults(data);
  assert.equal(cat.entries[0].name, 'E1');
  assert.equal(cat.entries[0].rank, 1);
  assert.equal(cat.entries[1].rank, null);
  assert.equal(cat.entries[1].normalized, null);
});

test('csv export includes leaderboard and raw matrix', () => {
  const data = fixture({
    judges: [J(1, 'A "Quoted" Judge')],
    scores: [S(1, 1, 1, 4), S(1, 1, 2, 4)],
  });
  const results = computeResults(data);
  const csv = resultsToCsv(results, data.criteria);
  assert.match(csv, /^category,rank,entry,avg_weighted/);
  assert.match(csv, /Cat A,1,E1,4\.0000/);
  assert.match(csv, /"A ""Quoted"" Judge"/);
});
