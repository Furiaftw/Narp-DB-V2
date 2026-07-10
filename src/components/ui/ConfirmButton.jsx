import { useEffect, useRef, useState } from 'react';

/*
 * Two-step action button: the first click arms it ("click again to confirm"),
 * the second click within `resetMs` fires onConfirm. Guards the pending-card
 * review actions (claim / review / approve / deny / join) against misclicks.
 */
export default function ConfirmButton({
  onConfirm,
  children,
  armedLabel = 'Click again to confirm',
  className = '',
  armedClassName = 'ring-2 ring-offset-1 ring-amber-400 animate-pulse',
  disabled = false,
  title,
  resetMs = 3500,
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Disarm if the button becomes disabled mid-confirmation (e.g. action started elsewhere)
  useEffect(() => {
    if (disabled) {
      clearTimeout(timerRef.current);
      setArmed(false);
    }
  }, [disabled]);

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setArmed(false), resetMs);
      return;
    }
    clearTimeout(timerRef.current);
    setArmed(false);
    onConfirm?.();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={armed ? 'Click again to confirm' : title}
      className={`${className} ${armed ? armedClassName : ''}`}
    >
      {armed ? armedLabel : children}
    </button>
  );
}
