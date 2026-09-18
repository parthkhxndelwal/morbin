"use client";

import { useRef } from "react";
import { VariableProximity } from "./variable-proximity";

const LINES = ["Organising events,", "minus the hard part."];

export function HeroTitle() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef}>
      <h1 className="text-[clamp(2.4rem,9vw,4.5rem)] font-bold leading-[1.04] tracking-tight lg:text-[clamp(3rem,6vw,5.5rem)]">
        {LINES.map((line) => (
          <span key={line} className="block">
            <VariableProximity
              label={line}
              containerRef={containerRef}
              fromVariation="'wght' 350"
              toVariation="'wght' 900"
              radius={160}
              falloff="linear"
            />
          </span>
        ))}
      </h1>
    </div>
  );
}
