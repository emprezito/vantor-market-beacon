import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Direction = "up" | "down" | null;

export function PriceFlash({
  value,
  children,
  className,
}: {
  value: number;
  children: ReactNode;
  className?: string;
}) {
  const previous = useRef(value);
  const [direction, setDirection] = useState<Direction>(null);

  useEffect(() => {
    const prior = previous.current;
    previous.current = value;
    if (!Number.isFinite(prior) || !Number.isFinite(value) || value === prior) return;

    setDirection(value > prior ? "up" : "down");
    const timeout = window.setTimeout(() => setDirection(null), 600);
    return () => window.clearTimeout(timeout);
  }, [value]);

  return (
    <span
      data-direction={direction ?? "flat"}
      className={cn(
        "inline-flex transition-colors duration-150",
        direction === "up" && "text-positive",
        direction === "down" && "text-negative",
        className,
      )}
    >
      {children}
    </span>
  );
}
