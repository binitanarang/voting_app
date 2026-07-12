/* Min–max band of judge weighted scores on a 1–5 track, with a tick at the
   average — a quick visual for spotting outlier disagreement. */
export default function SpreadBar({ spread, avg }) {
  if (!spread) return <span className="muted num">—</span>;
  const pct = (v) => ((v - 1) / 4) * 100;
  const left = pct(spread.min);
  const width = Math.max(pct(spread.max) - left, 1.5);
  return (
    <div className="spread" title={`min ${spread.min.toFixed(2)} · avg ${avg?.toFixed(2)} · max ${spread.max.toFixed(2)}`}>
      <div className="spread__band" style={{ left: `${left}%`, width: `${width}%` }} />
      {avg != null && <div className="spread__avg" style={{ left: `${pct(avg)}%` }} />}
    </div>
  );
}
