import { useState } from 'react';

// Password field with an eye button to reveal or hide what was typed.
export default function PasswordInput({ ...props }) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-toggle"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
          <circle cx="12" cy="12" r="3" />
          {show && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
    </span>
  );
}
