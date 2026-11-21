"use client";

import { useEffect, useState } from "react";

/** True once `on` has stayed true for `ms`; false again as soon as `on` is false. */
export function useDelayedFlag(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!on) return;
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && late;
}
