"use client";

import { useEffect, useRef } from "react";
import { mulberry32 } from "@/lib/astral";

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
}

interface LayerStar {
  x: number; // 0..1 in tile units
  y: number;
  r: number;
  base: number;
  amp: number;
  speed: number;
  phase: number;
  tint: number; // 0 white, 1 warm, 2 cool
}

/**
 * Full-bleed ambient starfield — three parallax layers of drifting stars,
 * occasional meteors. Optimized with:
 * 1. IntersectionObserver to automatically pause when scrolled off-screen.
 * 2. Document visibility listener to halt RAF when the tab is backgrounded.
 * 3. Batched 2D canvas path operations to reduce draw calls from 206 to under 10.
 */
export default function AmbientStars({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let isVisible = true;
    let isTabVisible = !document.hidden;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // build layers
    const rand = mulberry32(2026001);
    const layers: LayerStar[][] = [];
    const densities = [90, 70, 46];
    const sizes = [0.65, 1.0, 1.55];
    for (let l = 0; l < 3; l++) {
      const arr: LayerStar[] = [];
      for (let i = 0; i < densities[l]; i++) {
        const tintRoll = rand();
        arr.push({
          x: rand(),
          y: rand(),
          r: sizes[l] * (0.5 + rand()),
          base: 0.25 + rand() * 0.5,
          amp: 0.12 + rand() * 0.3,
          speed: 0.4 + rand() * 1.1,
          phase: rand() * Math.PI * 2,
          tint: tintRoll < 0.72 ? 0 : tintRoll < 0.88 ? 1 : 2,
        });
      }
      layers.push(arr);
    }

    const meteors: Meteor[] = [];
    let nextMeteor = 2600;

    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    const onMove = (e: PointerEvent) => {
      pointer.tx = e.clientX / window.innerWidth;
      pointer.ty = e.clientY / window.innerHeight;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    /* Palette tints: starlight, luminous and serene */
    const TINTS = ["238,242,255", "230,200,141", "157,189,214"];
    const START = performance.now();
    let last = START;

    const draw = (now: number) => {
      if (!isVisible || !isTabVisible) {
        raf = 0;
        return;
      }

      const t = (now - START) / 1000;
      const dt = Math.min(64, now - last);
      last = now;

      pointer.x += (pointer.tx - pointer.x) * 0.03;
      pointer.y += (pointer.ty - pointer.y) * 0.03;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Batch stars into 3 tint buckets with grouped paths to reduce draw calls by ~98%
      const batches: { x: number; y: number; r: number; alpha: number }[][] = [[], [], []];

      for (let l = 0; l < layers.length; l++) {
        const depth = (l + 1) / 3;
        const driftX = ((t * (2 + l * 2.4)) % (w + 80)) * 0.12;
        const px = (pointer.x - 0.5) * 26 * depth;
        const py = (pointer.y - 0.5) * 18 * depth;

        for (const s of layers[l]) {
          const x = ((s.x * (w + 90) - driftX * (l + 1) + px + w + 90) % (w + 90)) - 45;
          const y = s.y * (h + 40) + py - 20;
          const tw = s.base + s.amp * Math.sin(t * s.speed + s.phase);
          if (tw <= 0.03) continue;
          batches[s.tint].push({ x, y, r: s.r, alpha: tw });
        }
      }

      // Draw batched star passes
      for (let tint = 0; tint < 3; tint++) {
        const stars = batches[tint];
        if (!stars.length) continue;

        // Group into two intensity tiers (soft, bright) to maintain twinkle variety
        const soft: { x: number; y: number; r: number }[] = [];
        const bright: { x: number; y: number; r: number }[] = [];

        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          if (s.alpha > 0.48) {
            bright.push(s);
          } else {
            soft.push(s);
          }
        }

        if (soft.length) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(${TINTS[tint]},0.36)`;
          for (let i = 0; i < soft.length; i++) {
            const s = soft[i];
            ctx.moveTo(s.x + s.r, s.y);
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          }
          ctx.fill();
        }

        if (bright.length) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(${TINTS[tint]},0.72)`;
          for (let i = 0; i < bright.length; i++) {
            const s = bright[i];
            ctx.moveTo(s.x + s.r, s.y);
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }

      // Meteors
      nextMeteor -= dt;
      if (nextMeteor <= 0 && !reduced) {
        nextMeteor = 4200 + Math.random() * 6400;
        const mx = w * (0.15 + Math.random() * 0.75);
        const speed = 0.5 + Math.random() * 0.55;
        meteors.push({
          x: mx,
          y: -30,
          vx: -(120 + Math.random() * 160) * speed * (Math.random() < 0.5 ? -1 : 1),
          vy: (210 + Math.random() * 170) * speed,
          life: 0,
          ttl: 1400 + Math.random() * 900,
        });
      }

      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life += dt;
        m.x += (m.vx * dt) / 1000;
        m.y += (m.vy * dt) / 1000;
        const p = m.life / m.ttl;
        if (p >= 1 || m.y > h + 60) {
          meteors.splice(i, 1);
          continue;
        }
        const a = Math.sin(p * Math.PI) * 0.8;
        const tail = 90 + p * 60;
        const gx = m.x - (m.vx * tail) / 500;
        const gy = m.y - (m.vy * tail) / 500;
        const grad = ctx.createLinearGradient(m.x, m.y, gx, gy);
        grad.addColorStop(0, `rgba(238,242,255,${a.toFixed(3)})`);
        grad.addColorStop(1, "rgba(238,242,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(gx, gy);
        ctx.stroke();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    const startLoop = () => {
      if (!raf && isVisible && isTabVisible && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };

    // Pause when scrolled off-screen
    const io = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) {
        startLoop();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { threshold: 0.05 });
    io.observe(canvas);

    // Pause when browser tab is inactive
    const onVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible) {
        startLoop();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    startLoop();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
