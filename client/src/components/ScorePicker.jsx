export default function ScorePicker({ value, onChange, disabled }) {
  return (
    <div className="score-picker" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          className={value === n ? 'selected' : ''}
          disabled={disabled}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
