"use client";

import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArcImage } from "../lib/arc-provider";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./avatar.module.css";
export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> { name: string; src?: string; size?: "sm" | "md" | "lg" | "xl"; status?: "online" | "offline" }
export function Avatar({ name, src, size = "md", status, className, ...props }: AvatarProps) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]?.toUpperCase()).join("");
  const reduceMotion = !!useReducedMotion();
  const image = useRef<HTMLImageElement>(null);
  const [failedSrc, setFailedSrc] = useState<string>();
  // A photo that fails (often a rate limit when many load at once) shows the initials and tries again twice before giving up.
  const [retry, setRetry] = useState<{ src?: string; attempt: number; waiting: boolean }>({ src, attempt: 0, waiting: false });
  if (retry.src !== src) setRetry({ src, attempt: 0, waiting: false });
  useEffect(() => {
    if (!retry.waiting) return;
    const timer = window.setTimeout(() => setRetry(current => ({ ...current, attempt: current.attempt + 1, waiting: false })), 1500 * (retry.attempt + 1) + Math.random() * 1500);
    return () => window.clearTimeout(timer);
  }, [retry]);
  const fail = () => { if (retry.attempt < 2) setRetry(current => ({ ...current, waiting: true })); else setFailedSrc(src); };
  // A photo that is already decoded shows at once. One that is still loading waits, then fades in from a soft blur.
  useLayoutEffect(() => { const node = image.current; if (node && !node.complete) node.dataset.loading = ""; }, [src]);
  const showImage = src && failedSrc !== src && !retry.waiting;
  return <span {...props} className={[styles.avatar, styles[size], className].filter(Boolean).join(" ")} role="img" aria-label={`${name}${status ? `, ${status}` : ""}`}>
    {showImage ? <ArcImage key={`${src}#${retry.attempt}`} ref={image} src={src} alt="" fill sizes={size === "xl" ? "88px" : size === "lg" ? "48px" : size === "md" ? "36px" : "28px"} onLoad={event => { delete event.currentTarget.dataset.loading; }} onError={fail} /> : <span className={src ? styles.fallback : undefined} aria-hidden="true">{initials}</span>}
    <AnimatePresence initial={false}>{status && <motion.i key={status} className={[styles.status, styles[status]].join(" ")} aria-hidden="true" initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .6, transition: { duration: reduceMotion ? 0 : motionTokens.duration.fast } }} transition={reduceMotion ? { duration: 0 } : motionTokens.spring.snappy} />}</AnimatePresence>
  </span>;
}
