"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

export function TimelineScroller({
  children,
  ariaLabel
}: {
  children: ReactNode;
  ariaLabel?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);

  const smoothScrollBy = (delta: number) => {
    const el = trackRef.current;
    if (!el) return;
    const start = el.scrollLeft;
    const target = start + delta;
    const duration = 520;
    const startAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startAt) / duration);
      const ease = t * (2 - t);
      el.scrollLeft = start + (target - start) * ease;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const scrollBy = (dir: number) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.max(140, el.clientWidth * 0.25);
    smoothScrollBy(dir * amount);
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const el = trackRef.current;
      if (el && !dragging && !document.hidden && el.scrollWidth > el.clientWidth + 4) {
        const dt = now - last;
        const speed = 0.03;
        el.scrollLeft += speed * dt;
        if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) {
          el.scrollLeft = 0;
        }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    setDragging(true);
    dragStartX.current = event.clientX;
    dragStartScroll.current = el.scrollLeft;
    el.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const el = trackRef.current;
    if (!el) return;
    const delta = event.clientX - dragStartX.current;
    el.scrollLeft = dragStartScroll.current - delta;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    setDragging(false);
    el.releasePointerCapture(event.pointerId);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    handlePointerUp(event);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      el.scrollLeft += event.deltaY * 0.45;
      event.preventDefault();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      scrollBy(1);
    } else if (event.key === "ArrowLeft") {
      scrollBy(-1);
    } else if (event.key === "Home") {
      trackRef.current?.scrollTo({ left: 0, behavior: "smooth" });
    } else if (event.key === "End") {
      const el = trackRef.current;
      if (!el) return;
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    }
  };

  return (
    <div className="timeline-wrap">
      <button
        className="timeline-nav"
        type="button"
        aria-label="Anterior"
        data-loader="off"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          scrollBy(-1);
        }}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <div
        ref={trackRef}
        className={`timeline-track ${dragging ? "is-dragging" : ""}`}
        role="region"
        aria-label={ariaLabel || "Línea de tiempo"}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
      <button
        className="timeline-nav"
        type="button"
        aria-label="Siguiente"
        data-loader="off"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          scrollBy(1);
        }}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
