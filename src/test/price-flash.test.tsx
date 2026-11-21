import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PriceFlash } from "@/components/price-flash";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PriceFlash", () => {
  it("flashes up and down as the value changes", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<PriceFlash value={1}>1.0000</PriceFlash>);
    const direction = () =>
      container.querySelector("[data-direction]")?.getAttribute("data-direction");

    expect(direction()).toBe("flat");
    rerender(<PriceFlash value={2}>2.0000</PriceFlash>);
    expect(direction()).toBe("up");

    act(() => vi.advanceTimersByTime(600));
    expect(direction()).toBe("flat");

    rerender(<PriceFlash value={1.5}>1.5000</PriceFlash>);
    expect(direction()).toBe("down");
  });
});
