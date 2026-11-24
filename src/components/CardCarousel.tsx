"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MIN_CARD_WIDTH = 320;

export function visibleCardsForWidth(width: number): number {
  return Math.max(1, Math.min(3, Math.floor(width / MIN_CARD_WIDTH)));
}

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function serverMotionPreference() {
  return false;
}

interface CardCarouselProps {
  cards: CarouselCard[];
  label: string;
}

export interface CarouselCard {
  id: string;
  content: ReactNode;
}

export default function CardCarousel({ cards, label }: CardCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const navigationFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const navigationTargetRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const dragScrollTargetRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, serverMotionPreference);
  const maxIndex = Math.max(0, cards.length - visibleCount);
  const currentIndex = Math.min(activeIndex, maxIndex);
  const hasOverflow = cards.length > visibleCount;

  const navigateTo = useCallback((requestedIndex: number) => {
    const target = Math.max(0, Math.min(requestedIndex, Math.max(0, cards.length - visibleCount)));
    navigationTargetRef.current = target;
    if (navigationFrameRef.current !== null) return;
    navigationFrameRef.current = window.requestAnimationFrame(() => {
      navigationFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const next = navigationTargetRef.current;
      viewport.scrollTo({ left: (viewport.clientWidth / visibleCount) * next, behavior: reducedMotion ? "auto" : "smooth" });
      setActiveIndex(next);
    });
  }, [cards.length, reducedMotion, visibleCount]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateVisibleCount = (width: number) => setVisibleCount(visibleCardsForWidth(width));
    updateVisibleCount(viewport.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") {
      const update = () => updateVisibleCount(viewport.getBoundingClientRect().width);
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver((entries) => updateVisibleCount(entries[0]?.contentRect.width ?? 0));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const target = Math.min(navigationTargetRef.current, Math.max(0, cards.length - visibleCount));
    navigationTargetRef.current = target;
    // Keep the viewport aligned when responsive sizing or dynamic card counts change.
    setActiveIndex(target);
    if (navigationFrameRef.current !== null) window.cancelAnimationFrame(navigationFrameRef.current);
    navigationFrameRef.current = window.requestAnimationFrame(() => {
      navigationFrameRef.current = null;
      const next = navigationTargetRef.current;
      viewport.scrollTo({ left: (viewport.clientWidth / visibleCount) * next, behavior: "auto" });
      setActiveIndex(next);
    });
  }, [cards.length, visibleCount]);

  useEffect(() => () => {
    if (navigationFrameRef.current !== null) window.cancelAnimationFrame(navigationFrameRef.current);
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);

  const handleScroll = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const cardWidth = viewport.clientWidth / visibleCount;
      const next = Math.max(0, Math.min(Math.round(viewport.scrollLeft / cardWidth), maxIndex));
      navigationTargetRef.current = next;
      setActiveIndex(next);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateTo(navigationTargetRef.current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateTo(navigationTargetRef.current - 1);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !hasOverflow) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft, moved: false };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const viewport = event.currentTarget;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      suppressClickRef.current = true;
      viewport.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    dragScrollTargetRef.current = drag.startScrollLeft - (event.clientX - drag.startX);
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      if (dragScrollTargetRef.current !== null) viewport.scrollLeft = dragScrollTargetRef.current;
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  return (
    <section aria-label={label} className="min-w-0">
      <div
        ref={viewportRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }}
        className={`flex min-w-0 overflow-x-auto snap-x snap-mandatory overscroll-x-contain ${hasOverflow ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ scrollbarWidth: "none", touchAction: "pan-x", transform: "translateZ(0)" }}
      >
        {cards.map((card, index) => (
          <div
            key={card.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${cards.length}`}
            tabIndex={index === currentIndex ? 0 : -1}
            className="min-w-0 snap-start pr-3"
            style={{ flex: `0 0 ${100 / visibleCount}%` }}
          >
            {card.content}
          </div>
        ))}
      </div>
      {hasOverflow && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button type="button" className="btn btn-sm" aria-label="Previous slide" disabled={currentIndex === 0} onClick={() => navigateTo(navigationTargetRef.current - 1)}>Previous</button>
          <div role="group" aria-label="Choose slide" className="flex items-center gap-1.5">
            {Array.from({ length: maxIndex + 1 }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === currentIndex ? "true" : undefined}
                className={`h-2.5 w-2.5 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${index === currentIndex ? "bg-accent" : "bg-muted/50 hover:bg-muted"}`}
                onClick={() => navigateTo(index)}
              />
            ))}
          </div>
          <button type="button" className="btn btn-sm" aria-label="Next slide" disabled={currentIndex >= maxIndex} onClick={() => navigateTo(navigationTargetRef.current + 1)}>Next</button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{cards.length ? `Slide ${currentIndex + 1} of ${cards.length}` : "No slides"}</p>
    </section>
  );
}
