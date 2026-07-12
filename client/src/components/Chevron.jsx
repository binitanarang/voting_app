export default function Chevron({ open }) {
  return (
    <svg
      className={`chevron ${open ? 'chevron--open' : ''}`}
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
