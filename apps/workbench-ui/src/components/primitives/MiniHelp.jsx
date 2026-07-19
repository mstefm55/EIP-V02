import { useEffect, useRef, useState } from "react";

const HOVER_DELAY_MS = 3000;

function MiniHelp({ text, children }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleEnter() {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setOpen(true);
    }, HOVER_DELAY_MS);
  }

  function handleLeave() {
    clearTimer();
    setOpen(false);
  }

  useEffect(() => () => clearTimer(), []);

  if (!text) return children;

  return (
    <span
      className="minihelp-anchor"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      <span className={open ? "minihelp-bubble is-visible" : "minihelp-bubble"} role="tooltip">
        {text}
      </span>
    </span>
  );
}

export default MiniHelp;
