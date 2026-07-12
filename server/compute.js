/* Pure score math — no DB access, so it's unit-testable.
   Pipeline: raw 1–5 scores → weighted per judge/entry → per-judge
   z-standardization (Excel STANDARDIZE) → per-entry mean z → ranking. */

export function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* Population standard deviation, matching STANDARDIZE over a judge's own
   full set of scores. */
export function stddev(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/* Weighted 1–5 score for one judge on one entry.
   Returns null unless every criterion is scored. Weights are normalized by
   their sum so admin-entered percentages don't have to be exact fractions. */
export function weightedScore(scoresByCriterion, weightsByCriterion, criterionIds) {
  let total = 0;
  let weightSum = 0;
  for (const cid of criterionIds) {
    const s = scoresByCriterion[cid];
    if (s == null) return null;
    const w = weightsByCriterion[cid] ?? 0;
    total += s * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : null;
}

/**
 * @param data — shape of db.loadCompetition():
 *   categories, criteria, weights [{category_id, criterion_id, weight}],
 *   panels [{id, category_id}], judges [{id, panel_id, ...}],
 *   entries [{id, category_id, ...}], scores [{judge_id, entry_id, criterion_id, score}]
 * @returns per category: judges (with mean/sd/progress) and entries ranked by
 *   normalized score (tiebreak: average weighted score), each with the full
 *   judge × criterion matrix, weighted scores, z adjustments, and min/max spread.
 */
export function computeResults(data) {
  const { categories, criteria, weights, panels, judges, entries, scores } = data;
  const criterionIds = criteria.map((c) => c.id);

  const weightsByCategory = {}; // categoryId -> {criterionId: weight}
  for (const w of weights) {
    (weightsByCategory[w.category_id] ??= {})[w.criterion_id] = w.weight;
  }

  const panelCategory = Object.fromEntries(panels.map((p) => [p.id, p.category_id]));

  const scoreMap = {}; // judgeId -> entryId -> {criterionId: score}
  for (const s of scores) {
    ((scoreMap[s.judge_id] ??= {})[s.entry_id] ??= {})[s.criterion_id] = s.score;
  }

  return categories.map((cat) => {
    const catEntries = entries.filter((e) => e.category_id === cat.id);
    const catJudges = judges.filter((j) => j.panel_id != null && panelCategory[j.panel_id] === cat.id);
    const catWeights = weightsByCategory[cat.id] ?? {};

    // Weighted score per judge per entry (null = incomplete ballot for that entry).
    const weighted = {}; // judgeId -> entryId -> number|null
    for (const j of catJudges) {
      weighted[j.id] = {};
      for (const e of catEntries) {
        weighted[j.id][e.id] = weightedScore(scoreMap[j.id]?.[e.id] ?? {}, catWeights, criterionIds);
      }
    }

    // Per-judge distribution stats over the entries they fully scored.
    const judgeStats = catJudges.map((j) => {
      const vals = catEntries.map((e) => weighted[j.id][e.id]).filter((v) => v != null);
      const m = vals.length ? mean(vals) : null;
      const sd = vals.length ? stddev(vals) : null;
      return {
        id: j.id,
        name: j.name,
        employeeId: j.employee_id,
        mean: m,
        sd,
        scoredCount: vals.length,
        totalEntries: catEntries.length,
      };
    });
    const statsById = Object.fromEntries(judgeStats.map((s) => [s.id, s]));

    const resultEntries = catEntries.map((e) => {
      const perJudge = catJudges.map((j) => {
        const w = weighted[j.id][e.id];
        const st = statsById[j.id];
        let z = null;
        if (w != null) {
          // sd of 0 (judge gave identical scores everywhere) → mean-center to 0
          // instead of dividing by zero.
          z = st.sd > 0 ? (w - st.mean) / st.sd : 0;
        }
        return {
          judgeId: j.id,
          judgeName: j.name,
          criteria: scoreMap[j.id]?.[e.id] ?? {},
          weighted: w,
          z,
        };
      });

      const done = perJudge.filter((p) => p.weighted != null);
      const ws = done.map((p) => p.weighted);
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        position: e.position,
        perJudge,
        judgesScored: done.length,
        judgesTotal: catJudges.length,
        avgWeighted: ws.length ? mean(ws) : null,
        normalized: done.length ? mean(done.map((p) => p.z)) : null,
        spread: ws.length ? { min: Math.min(...ws), max: Math.max(...ws) } : null,
      };
    });

    // Rank: normalized desc, tiebreak avg weighted desc; unscored entries last.
    const ranked = [...resultEntries].sort((a, b) => {
      if (a.normalized == null && b.normalized == null) return a.position - b.position;
      if (a.normalized == null) return 1;
      if (b.normalized == null) return -1;
      return (b.normalized - a.normalized) || (b.avgWeighted - a.avgWeighted) || (a.position - b.position);
    });
    ranked.forEach((e, i) => { e.rank = e.normalized == null ? null : i + 1; });

    return {
      id: cat.id,
      name: cat.name,
      locked: !!cat.voting_locked,
      weights: criterionIds.map((cid) => ({ criterionId: cid, weight: catWeights[cid] ?? 0 })),
      judges: judgeStats,
      entries: ranked,
    };
  });
}

export function resultsToCsv(results, criteria) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v, d = 4) => (v == null ? '' : v.toFixed(d));
  const lines = [];

  lines.push(['category', 'rank', 'entry', 'avg_weighted', 'normalized', 'judges_scored', 'judges_total', 'min_weighted', 'max_weighted'].join(','));
  for (const cat of results) {
    for (const e of cat.entries) {
      lines.push([
        esc(cat.name), e.rank ?? '', esc(e.name),
        num(e.avgWeighted), num(e.normalized),
        e.judgesScored, e.judgesTotal,
        num(e.spread?.min, 2), num(e.spread?.max, 2),
      ].join(','));
    }
  }

  lines.push('');
  lines.push(['category', 'entry', 'judge', ...criteria.map((c) => esc(c.name)), 'weighted', 'z_score'].join(','));
  for (const cat of results) {
    for (const e of cat.entries) {
      for (const pj of e.perJudge) {
        lines.push([
          esc(cat.name), esc(e.name), esc(pj.judgeName),
          ...criteria.map((c) => pj.criteria[c.id] ?? ''),
          num(pj.weighted, 2), num(pj.z),
        ].join(','));
      }
    }
  }
  return lines.join('\n') + '\n';
}
