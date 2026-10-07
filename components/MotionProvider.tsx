"use client";

import { MotionConfig } from "framer-motion";

/**
 * Makes every framer-motion animation respect the OS "reduce motion" setting:
 * transform and layout animations are skipped, opacity fades still run.
 * CSS transitions are covered by the blanket rule in globals.css.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
