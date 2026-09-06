/**
 * Keeps the newest row in view as the reel advances, and lets go the moment
 * you scroll back to read something.
 *
 * The reel is its own scroller on the theatre layout and plain document flow
 * below it, so "the bottom" is measured against whichever viewport is
 * actually doing the scrolling.
 */

import { useEffect, useRef, type RefObject } from 'react';

/** How close to the bottom still counts as following the playhead. */
const STICK_THRESHOLD_PX = 56;

/** Clearance left under the newest row when the page is the scroller. */
const DOC_BOTTOM_MARGIN_PX = 140;

function isScroller(element: HTMLElement): boolean {
  const overflow = getComputedStyle(element).overflowY;
  return overflow === 'auto' || overflow === 'scroll';
}

function distanceFromBottom(element: HTMLElement): number {
  if (isScroller(element)) {
    return element.scrollHeight - element.scrollTop - element.clientHeight;
  }
  const rect = element.getBoundingClientRect();
  return rect.bottom - window.innerHeight + DOC_BOTTOM_MARGIN_PX;
}

export function useFollowPlayhead(
  scroller: RefObject<HTMLDivElement | null>,
  index: number,
  playing: boolean,
): () => void {
  const following = useRef(true);

  // Pressing play re-attaches the view to the playhead.
  useEffect(() => {
    if (playing) following.current = true;
  }, [playing]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !following.current) return;

    if (isScroller(element)) {
      element.scrollTop = element.scrollHeight;
      return;
    }

    const overshoot = distanceFromBottom(element);
    if (overshoot > 0) window.scrollBy(0, overshoot);
  }, [scroller, index]);

  useEffect(() => {
    const onScroll = () => {
      const element = scroller.current;
      if (!element || isScroller(element)) return;
      following.current = distanceFromBottom(element) <= STICK_THRESHOLD_PX;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [scroller]);

  return () => {
    const element = scroller.current;
    if (!element || !isScroller(element)) return;
    following.current = distanceFromBottom(element) <= STICK_THRESHOLD_PX;
  };
}
