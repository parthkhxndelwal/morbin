"use client";

import { useEffect, useRef } from "react";

type Falloff = "linear" | "exponential" | "gaussian";

interface VariableProximityProps {
  label: string;
  fromVariation?: string;
  toVariation?: string;
  radius?: number;
  falloff?: Falloff;
  containerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

function parseWght(settings: string): number {
  const m = /wght['"]?\s+(\d+)/.exec(settings);
  return m ? parseInt(m[1], 10) : 400;
}

function proximity(distance: number, radius: number, falloff: Falloff): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  switch (falloff) {
    case "exponential":
      return t * t;
    case "gaussian":
      return Math.exp(-Math.pow(distance / (radius / 2), 2));
    default:
      return t;
  }
}

/**
 * Variable-font proximity animation: characters near the cursor interpolate
 * from `fromVariation` to `toVariation` (e.g. light → black weight).
 * Requires a variable font with a wght axis (Geist qualifies).
 */
export function VariableProximity({
  label,
  fromVariation = "'wght' 400",
  toVariation = "'wght' 800",
  radius = 150,
  falloff = "linear",
  containerRef,
  className,
}: VariableProximityProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const charsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const rafRef = useRef(0);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  const fromW = parseWght(fromVariation);
  const toW = parseWght(toVariation);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const container = containerRef?.current ?? rootRef.current;
    if (!container) return;

    const update = () => {
      rafRef.current = 0;
      const { x, y } = mouseRef.current;
      for (const el of charsRef.current) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        const w = Math.round(fromW + (toW - fromW) * proximity(d, radius, falloff));
        el.style.fontVariationSettings = `'wght' ${w}`;
      }
    };
    const schedule = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(update);
    };
    const onMove = (e: PointerEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      schedule();
    };
    const onLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
      schedule();
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    schedule(); // paint rest state

    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, falloff, radius, fromW, toW]);

  const words = label.split(" ");
  let ci = 0;

  return (
    <span
      ref={rootRef}
      className={className}
      aria-label={label}
      style={{ fontVariationSettings: fromVariation }}
    >
      {words.map((word, wi) => (
        <span key={wi} className="inline-block whitespace-pre" aria-hidden="true">
          {word.split("").map((ch, i) => {
            const idx = ci++;
            return (
              <span
                key={i}
                ref={(el) => {
                  charsRef.current[idx] = el;
                }}
                className="inline-block will-change-[font-variation-settings]"
              >
                {ch}
              </span>
            );
          })}
          {wi < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
