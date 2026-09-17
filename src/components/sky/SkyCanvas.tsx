"use client";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { birthOrdered, MOOD_KEYS, MOODS, mulberry32, starTitle, type MoodKey, type StarDto } from "@/lib/astral";

export interface SkyCanvasHandle {
  focusStar: (star: StarDto) => void;
  birthStar: (star: StarDto) => void;
  frameStars: (stars: StarDto[]) => void;
  zoomBy: (factor: number) => void;
  resetView: () => void;
}
interface Props {
  stars: StarDto[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Clicking a constellation's name focuses it. */
  onFocusMood?: (mood: MoodKey) => void;
  /** Attention: when set, only these stars are lit; the rest dim but stay. */
  highlight?: Set<string> | null;
  /** Time: how many stars, in birth order, exist. null = now. */
  horizon?: number | null;
  /** Size of the open dock, so the sky centres in the space it leaves. */
  inset?: { right?: number; bottom?: number };
  /** Non-interactive rendering (the landing page's preview of your sky). */
  preview?: boolean;
}
type Point = { x: number; y: number };
type Camera = Point & { z: number; tx: number; ty: number; tz: number };
type Edge = { a: StarDto; b: StarDto; formed: number };
type Group = { mood: MoodKey; members: StarDto[]; edges: Edge[] };
type Scene = { sorted: StarDto[]; birth: Map<string, number>; groups: Group[]; edgeCount: number };
type LabelHit = { mood: MoodKey; x0: number; y0: number; x1: number; y1: number };

function rgb(hex: string) { const n = parseInt(hex.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; }
const COLORS = Object.fromEntries(MOOD_KEYS.map(m => [m, rgb(MOODS[m].hex)])) as Record<MoodKey, string>;

/**
 * A constellation is a tree that grows. Each new memory attaches to the nearest
 * memory of the same feeling that already existed, so every thread has a birth
 * moment, threads never cross the whole sky, and winding time back un-forms the
 * shape exactly as it formed. Computed once per journal change.
 */
function buildScene(stars: StarDto[]): Scene {
  const sorted = birthOrdered(stars);
  const birth = new Map(sorted.map((s, i) => [s.id, i] as const));
  let edgeCount = 0;
  const groups = MOOD_KEYS.map(mood => {
    const members = sorted.filter(s => s.mood === mood);
    const edges: Edge[] = [];
    for (let i = 1; i < members.length; i++) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const d = Math.hypot(members[i].x - members[j].x, members[i].y - members[j].y);
        if (d < bestD) { bestD = d; best = j; }
      }
      edges.push({ a: members[best], b: members[i], formed: birth.get(members[i].id) ?? i });
    }
    edgeCount += edges.length;
    return { mood, members, edges };
  }).filter(g => g.members.length > 0);
  return { sorted, birth, groups, edgeCount };
}

const SkyCanvas = forwardRef<SkyCanvasHandle, Props>(function SkyCanvas(
  { stars, selectedId = null, onSelect, onFocusMood, highlight = null, horizon = null, inset, preview = false }, ref,
) {
  const rightInset = inset?.right ?? 0, bottomInset = inset?.bottom ?? 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const announcement = useRef<HTMLSpanElement>(null);
  const scene = useMemo(() => buildScene(stars), [stars]);
  const state = useRef({ scene, selectedId, onSelect, onFocusMood, highlight, horizon, rightInset, bottomInset, preview });
  const camera = useRef<Camera>({ x: 0, y: 0, z: .7, tx: 0, ty: 0, tz: .7 });
  const size = useRef({ w: 600, h: 800, dpr: 1 });
  const invalidate = useRef<() => void>(() => { });
  const reframe = useRef<() => void>(() => { });
  const burst = useRef<{ star: StarDto; started: number } | null>(null);

  useEffect(() => {
    state.current = { scene, selectedId, onSelect, onFocusMood, highlight, horizon, rightInset, bottomInset, preview };
    invalidate.current();
  }, [scene, selectedId, onSelect, onFocusMood, highlight, horizon, rightInset, bottomInset, preview]);

  useImperativeHandle(ref, () => ({
    focusStar(star) {
      const cam = camera.current;
      cam.tx = star.x; cam.ty = star.y; cam.tz = Math.min(3.4, Math.max(cam.tz, 1.7));
      invalidate.current();
    },
    birthStar(star) {
      const cam = camera.current;
      burst.current = { star, started: performance.now() };
      cam.tx = star.x; cam.ty = star.y; cam.tz = Math.min(3.4, Math.max(cam.tz, 1.15));
      invalidate.current();
    },
    frameStars(list) {
      if (!list.length) return;
      const xs = list.map(s => s.x), ys = list.map(s => s.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const { w, h } = size.current, cam = camera.current, proj = Math.min(2.1, Math.max(1, w / Math.max(1, h) * .62));
      const availW = Math.max(120, w - state.current.rightInset - 80), availH = Math.max(120, h - state.current.bottomInset - 190);
      cam.tz = Math.max(.45, Math.min(2.4, availW / ((maxX - minX + 70) * proj), availH / (maxY - minY + 60)));
      cam.tx = (minX + maxX) / 2; cam.ty = (minY + maxY) / 2;
      invalidate.current();
    },
    zoomBy(factor) { const cam = camera.current; cam.tz = Math.max(.3, Math.min(3.4, cam.tz * factor)); invalidate.current(); },
    resetView() { reframe.current(); },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const interactive = !state.current.preview;
    let raf = 0, visible = true, live = true, hover: string | null = null, hoverLabel: MoodKey | null = null, keyboardIndex = -1;
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const random = mulberry32(0xa57e);
    const background = Array.from({ length: 320 }, () => ({ x: random(), y: random(), r: .3 + random() * .9, a: .12 + random() * .42, phase: random() * 6.28 }));
    const starBuckets: Array<Array<{ x: number; y: number; r: number }>> = [[], [], []];
    background.forEach(s => {
      const b = Math.min(2, Math.floor(s.a * 3));
      starBuckets[b].push({ x: s.x, y: s.y, r: s.r });
    });
    const glowSprites = new Map<MoodKey, HTMLCanvasElement>();
    if (typeof document !== "undefined") {
      MOOD_KEYS.forEach(m => {
        const sprite = document.createElement("canvas");
        sprite.width = 64;
        sprite.height = 64;
        const sCtx = sprite.getContext("2d");
        if (sCtx) {
          const rad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
          const col = COLORS[m];
          rad.addColorStop(0, `rgba(${col},0.45)`);
          rad.addColorStop(0.35, `rgba(${col},0.15)`);
          rad.addColorStop(1, `rgba(${col},0)`);
          sCtx.fillStyle = rad;
          sCtx.fillRect(0, 0, 64, 64);
          glowSprites.set(m, sprite);
        }
      });
    }
    const shimmer = new Map<string, number>();
    const arrivals = new Map<string, number>();
    let lastHorizon = -1, labelHits: LabelHit[] = [];
    /* Canvas rejects var() inside the font shorthand, so the display stack is assembled here
       rather than read from --font-display — and it must mirror that stack exactly: the kit
       face leads, the self-hosted Fraunces name follows as fallback, and the generic serif
       always closes the list so a blocked kit still lands on a real face instead of the
       canvas default. The redraw after document.fonts.ready below is what makes the webfont
       actually appear on the canvas. */
    const frauncesName = getComputedStyle(document.documentElement).getPropertyValue("--font-fraunces")?.trim();
    const displayFont = ['"daith-vf"', frauncesName, '"Georgia", serif'].filter(Boolean).join(", ");
    let lastMeteor = performance.now() - 12000, meteor: { x: number; y: number; life: number; last: number } | null = null;

    const projection = () => Math.min(2.1, Math.max(1, size.current.w / Math.max(1, size.current.h) * .62));
    const centreX = () => (size.current.w - state.current.rightInset) / 2;
    const centreY = () => (size.current.h - state.current.bottomInset) / 2;
    const screen = (s: Point): Point => ({
      x: (s.x - camera.current.x) * camera.current.z * projection() + centreX(),
      y: (s.y - camera.current.y) * camera.current.z + centreY(),
    });
    const schedule = () => { if (live && !raf && visible && !document.hidden) raf = requestAnimationFrame(draw); };
    invalidate.current = schedule;
    const frameAll = (snap = false) => {
      const list = state.current.scene.sorted;
      const cam = camera.current;
      if (!list.length) { cam.tx = 0; cam.ty = 0; cam.tz = .9; if (snap) { cam.x = 0; cam.y = 0; cam.z = .9; } schedule(); return; }
      const xs = list.map(s => s.x), ys = list.map(s => s.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const { w, h } = size.current, proj = projection();
      const availW = Math.max(140, w - state.current.rightInset - 70), availH = Math.max(160, h - state.current.bottomInset - 190);
      cam.tz = Math.max(.3, Math.min(1.85, availW / ((maxX - minX + 100) * proj), availH / (maxY - minY + 80)));
      cam.tx = (minX + maxX) / 2; cam.ty = (minY + maxY) / 2;
      if (snap) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; }
      schedule();
    };
    reframe.current = () => frameAll();

    function horizonOf() {
      const s = state.current;
      return s.horizon == null ? s.scene.sorted.length : Math.max(0, Math.min(s.scene.sorted.length, s.horizon));
    }
    function isBorn(s: StarDto) {
      return (state.current.scene.birth.get(s.id) ?? 0) < horizonOf();
    }
    function isLit(s: StarDto) {
      return isBorn(s) && (!state.current.highlight || state.current.highlight.has(s.id));
    }
    function hitStar(x: number, y: number) {
      let result: StarDto | null = null, distance = 20;
      for (const s of state.current.scene.sorted) {
        if (!isLit(s)) continue;
        const p = screen(s), d = Math.hypot(x - p.x, y - p.y);
        if (d < distance) { distance = d; result = s; }
      }
      return result;
    }
    function hitLabel(x: number, y: number) {
      return labelHits.find(l => x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1) ?? null;
    }

    const pointers = new Map<number, Point>();
    let moved = 0, pinched = false, lastPinch = 0;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) { moved = 0; pinched = false; }
      if (pointers.size === 2) { pinched = true; const [a, b] = [...pointers.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); }
      canvas.style.cursor = "grabbing";
    };
    const onMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const previous = pointers.get(event.pointerId), cam = camera.current;
      if (previous) {
        const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        moved += Math.abs(dx) + Math.abs(dy);
        if (pointers.size === 1) { cam.tx -= dx / (cam.tz * projection()); cam.ty -= dy / cam.tz; }
        else if (pointers.size === 2) {
          const [a, b] = [...pointers.values()], dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (lastPinch) cam.tz = Math.max(.3, Math.min(3.4, cam.tz * dist / lastPinch));
          lastPinch = dist;
        }
        schedule();
      } else {
        const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
        const star = hitStar(x, y), label = star ? null : hitLabel(x, y);
        const nextHover = star?.id || null, nextLabel = label?.mood || null;
        if (nextHover !== hover || nextLabel !== hoverLabel) {
          hover = nextHover; hoverLabel = nextLabel;
          canvas.style.cursor = hover || hoverLabel ? "pointer" : "grab"; schedule();
        }
      }
    };
    const onUp = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (pointers.size === 0 && moved < 7 && !pinched) {
        const bounds = canvas.getBoundingClientRect();
        const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
        const star = hitStar(x, y);
        if (star) state.current.onSelect?.(star.id);
        else { const label = hitLabel(x, y); if (label) state.current.onFocusMood?.(label.mood); else state.current.onSelect?.(null); }
      }
      canvas.style.cursor = "grab"; schedule();
    };
    const onCancel = () => { pointers.clear(); pinched = true; canvas.style.cursor = "grab"; };
    const onLeave = () => { if (!pointers.size && (hover || hoverLabel)) { hover = null; hoverLabel = null; schedule(); } };
    const onWheel = (event: WheelEvent) => {
      if (document.activeElement !== canvas && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect(), cam = camera.current;
      const px = event.clientX - bounds.left - centreX(), py = event.clientY - bounds.top - centreY();
      const z = Math.max(.3, Math.min(3.4, cam.tz * Math.exp(-event.deltaY * .0018)));
      cam.tx = cam.tx + px / (cam.tz * projection()) - px / (z * projection());
      cam.ty = cam.ty + py / cam.tz - py / z;
      cam.tz = z; schedule();
    };
    const onKey = (event: KeyboardEvent) => {
      const lit = state.current.scene.sorted.filter(isLit);
      if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key) && lit.length) {
        event.preventDefault();
        const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
        keyboardIndex = (keyboardIndex + (back ? -1 : 1) + lit.length) % lit.length;
        const star = lit[keyboardIndex];
        hover = star.id; hoverLabel = null;
        const p = screen(star), { w, h } = size.current;
        if (p.x < 50 || p.x > w - state.current.rightInset - 50 || p.y < 90 || p.y > h - state.current.bottomInset - 100) { camera.current.tx = star.x; camera.current.ty = star.y; }
        announcement.current?.replaceChildren(`${starTitle(star)}. ${MOODS[star.mood].label}. ${lit.length > 1 ? `${keyboardIndex + 1} of ${lit.length}. ` : ""}Press Enter to read.`);
      } else if (event.key === "Enter" && hover) { event.preventDefault(); state.current.onSelect?.(hover); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); camera.current.tz = Math.min(3.4, camera.current.tz * 1.3); }
      else if (event.key === "-") { event.preventDefault(); camera.current.tz = Math.max(.3, camera.current.tz / 1.3); }
      else if (event.key === "0" || event.key === "Home") { event.preventDefault(); frameAll(); }
      schedule();
    };
    if (interactive) {
      canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onCancel);
      canvas.addEventListener("pointerleave", onLeave); canvas.addEventListener("keydown", onKey);
      canvas.addEventListener("wheel", onWheel, { passive: false });
    }

    function draw(now: number) {
      if (!ctx) return;
      raf = 0;
      const { w, h, dpr } = size.current, cam = camera.current, cur = state.current, sc = cur.scene;
      const t = reduced ? 0 : now / 1000, easing = reduced ? 1 : .1;
      cam.x += (cam.tx - cam.x) * easing; cam.y += (cam.ty - cam.y) * easing; cam.z += (cam.tz - cam.z) * easing;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Batch background stars into 3 passes (turns 320 separate arc+fill calls into 3)
      for (let b = 0; b < 3; b++) {
        const alpha = (0.14 + b * 0.14) * (0.8 + 0.2 * Math.sin(t * 0.5 + b * 2.1));
        ctx.fillStyle = `rgba(202,211,238,${alpha.toFixed(3)})`;
        ctx.beginPath();
        for (const s of starBuckets[b]) {
          const x = ((s.x * w - cam.x * .03) % w + w) % w, y = ((s.y * h - cam.y * .03) % h + h) % h;
          ctx.moveTo(x + s.r, y);
          ctx.arc(x, y, s.r, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // Time: stars that arrive since the last frame pulse; stars that un-form take their pulses with them.
      const H = horizonOf();
      if (lastHorizon === -1) lastHorizon = H;
      else if (H > lastHorizon) { for (let i = Math.max(lastHorizon, H - 12); i < H; i++) { const s = sc.sorted[i]; if (s) arrivals.set(s.id, now); } lastHorizon = H; }
      else if (H < lastHorizon) { for (let i = H; i < Math.min(lastHorizon, sc.sorted.length); i++) arrivals.delete(sc.sorted[i].id); lastHorizon = H; }
      const fancy = sc.edgeCount < 400;
      labelHits = [];

      for (const g of sc.groups) {
        const color = COLORS[g.mood];
        const bornMembers = g.members.filter(isBorn);
        if (!bornMembers.length) continue;
        const litCount = bornMembers.filter(isLit).length;
        const inFocus = !cur.highlight || litCount > 0;

        // Threads: each fades toward its stars, brightens when newly formed, then settles.
        const liveEdges: Edge[] = [];
        for (const e of g.edges) {
          if (!isBorn(e.a) || !isBorn(e.b)) continue;
          const bothLit = isLit(e.a) && isLit(e.b);
          if (bothLit) liveEdges.push(e);
          const age = H - 1 - e.formed;
          let alpha = bothLit ? .3 : .08;
          if (bothLit && age < 6) alpha = .3 + (1 - age / 6) * .45;
          const pa = screen(e.a), pb = screen(e.b);
          if (fancy) {
            const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
            grad.addColorStop(0, `rgba(${color},${(alpha * .35).toFixed(3)})`);
            grad.addColorStop(.5, `rgba(${color},${alpha.toFixed(3)})`);
            grad.addColorStop(1, `rgba(${color},${(alpha * .35).toFixed(3)})`);
            ctx.strokeStyle = grad;
          } else ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
          ctx.lineWidth = bothLit && age < 2 ? 1.25 : .85;
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
        if (!reduced && liveEdges.length && cur.horizon == null) {
          const progress = (t * .12 + MOOD_KEYS.indexOf(g.mood) * .37) % liveEdges.length;
          const e = liveEdges[Math.floor(progress)], f = progress % 1;
          const p = screen({ x: e.a.x + (e.b.x - e.a.x) * f, y: e.a.y + (e.b.y - e.a.y) * f });
          ctx.fillStyle = `rgba(${color},.6)`; ctx.beginPath(); ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2); ctx.fill();
        }

        // The constellation's name, once it is a shape. It is a button: clicking it focuses the constellation.
        if (bornMembers.length >= 2 && cam.z < 3.2) {
          const cx = bornMembers.reduce((a, s) => a + s.x, 0) / bornMembers.length;
          const p = screen({ x: cx, y: Math.max(...bornMembers.map(s => s.y)) + 26 });
          if (p.y > 84 && p.y < h - cur.bottomInset - 40 && p.x > 30 && p.x < w - cur.rightInset - 30) {
            const text = MOODS[g.mood].label;
            ctx.font = `italic 15px ${displayFont}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const width = ctx.measureText(text).width;
            const hovered = hoverLabel === g.mood && interactive;
            ctx.fillStyle = `rgba(${color},${!inFocus ? .24 : hovered ? .95 : .62})`;
            ctx.fillText(text, p.x, p.y);
            if (hovered) { ctx.strokeStyle = `rgba(${color},.55)`; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(p.x - width / 2, p.y + 10); ctx.lineTo(p.x + width / 2, p.y + 10); ctx.stroke(); }
            labelHits.push({ mood: g.mood, x0: p.x - width / 2 - 10, y0: p.y - 13, x1: p.x + width / 2 + 10, y1: p.y + 15 });
          }
        }

        for (const star of bornMembers) {
          const p = screen(star);
          if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) continue;
          const lit = isLit(star);
          let phase = shimmer.get(star.id);
          if (phase === undefined) { phase = (star.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 63) / 10; shimmer.set(star.id, phase); }
          const twinkle = .82 + .18 * Math.sin(t * .8 + phase);
          const active = interactive && (star.id === hover || star.id === cur.selectedId);
          const sizePx = (1.7 + star.intensity * .46) * Math.sqrt(cam.z) * (active ? 1.25 : 1);
          ctx.save();
          ctx.globalAlpha = lit ? 1 : .18;
          // An arrival is a breath of the star's own light: the glow swells and settles, no drawn ring.
          const arrived = arrivals.get(star.id);
          if (arrived !== undefined && !reduced) {
            const age = (now - arrived) / 1500;
            if (age >= 1) arrivals.delete(star.id);
            else {
              const swell = Math.sin(age * Math.PI);
              const r = sizePx * (12 + swell * 10);
              const bloom = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
              bloom.addColorStop(0, `rgba(255,250,236,${(swell * .55).toFixed(3)})`);
              bloom.addColorStop(.3, `rgba(${color},${(swell * .3).toFixed(3)})`);
              bloom.addColorStop(1, `rgba(${color},0)`);
              ctx.fillStyle = bloom; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
            }
          }
          const radius = sizePx * (active ? 16 : 12.5);
          const sprite = glowSprites.get(g.mood);
          if (sprite) {
            ctx.save();
            ctx.globalAlpha = (lit ? 1 : .18) * twinkle;
            ctx.drawImage(sprite, p.x - radius, p.y - radius, radius * 2, radius * 2);
            ctx.restore();
          }
          if (lit && (star.intensity >= 4 || active)) {
            const spike = sizePx * (star.intensity === 5 ? 6.2 : 4.4);
            ctx.strokeStyle = `rgba(${color},${(.45 * twinkle).toFixed(3)})`; ctx.lineWidth = .55;
            ctx.beginPath(); ctx.moveTo(p.x - spike, p.y); ctx.lineTo(p.x + spike, p.y); ctx.moveTo(p.x, p.y - spike); ctx.lineTo(p.x, p.y + spike); ctx.stroke();
          }
          ctx.fillStyle = MOODS[g.mood].hex; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.5, sizePx * twinkle), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(255,252,242,${(.9 * twinkle).toFixed(3)})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.4, sizePx * .45), 0, Math.PI * 2); ctx.fill();
          if (star.favorite && lit) {
            ctx.strokeStyle = `rgba(${color},.55)`; ctx.lineWidth = .7; ctx.setLineDash([1.5, 3.5]);
            ctx.beginPath(); ctx.arc(p.x, p.y, sizePx * 2.6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          }
          if (active && lit) {
            ctx.strokeStyle = `rgba(${color},.75)`; ctx.lineWidth = .8;
            ctx.beginPath(); ctx.arc(p.x, p.y, sizePx * 4.2, 0, Math.PI * 2); ctx.stroke();
            const text = starTitle(star).slice(0, 42);
            ctx.font = `14px ${displayFont}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
            const width = ctx.measureText(text).width;
            const tx = Math.max(14, Math.min(w - width - 22, p.x - width / 2)), ty = p.y > 76 ? p.y - 28 : p.y + 36;
            ctx.fillStyle = "rgba(8,10,18,.84)"; ctx.fillRect(tx - 9, ty - 16, width + 18, 27);
            ctx.fillStyle = "#ece5d8"; ctx.fillText(text, tx, ty + 2);
          }
          ctx.restore();
        }
      }

      const birth = burst.current;
      if (birth && !reduced) {
        const age = (now - birth.started) / 1800;
        if (age > 1) burst.current = null;
        else {
          const p = screen(birth.star), color = COLORS[birth.star.mood];
          ctx.strokeStyle = `rgba(${color},${(.8 * (1 - age)).toFixed(3)})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (1 - Math.pow(1 - age, 3)) * 88, 0, Math.PI * 2); ctx.stroke();
          for (let i = 0; i < 20; i++) {
            const a = i * 2.3999, d = (22 + i * 2.2) * age;
            ctx.fillStyle = `rgba(${color},${(1 - age).toFixed(3)})`;
            ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1.1, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      if (!reduced) {
        if (!meteor && now - lastMeteor > 19000) { meteor = { x: w * .8, y: 40 + Math.random() * h * .25, life: 0, last: now }; lastMeteor = now; }
        if (meteor) {
          const dt = Math.min(48, now - meteor.last); meteor.last = now; meteor.life += dt;
          meteor.x -= dt * .17; meteor.y += dt * .1;
          const a = Math.max(0, Math.sin(meteor.life / 1250 * Math.PI) * .5);
          if (meteor.life > 1250) meteor = null;
          else {
            const grad = ctx.createLinearGradient(meteor.x, meteor.y, meteor.x + 78, meteor.y - 46);
            grad.addColorStop(0, `rgba(233,225,246,${a.toFixed(3)})`); grad.addColorStop(1, "rgba(233,225,246,0)");
            ctx.strokeStyle = grad; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(meteor.x, meteor.y); ctx.lineTo(meteor.x + 78, meteor.y - 46); ctx.stroke();
          }
        }
      }
      if (!reduced) {
        if (state.current.preview) {
          window.setTimeout(schedule, 33);
        } else {
          schedule();
        }
      }
    }

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w <= 0 || h <= 0) return;
      const newWidth = Math.max(1, Math.floor(w * dpr));
      const newHeight = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        size.current = { w, h, dpr };
        draw(performance.now());
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    frameAll(true);

    const io = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) schedule();
      else { cancelAnimationFrame(raf); raf = 0; }
    });
    io.observe(canvas);

    const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else schedule(); };
    const onMotion = () => { reduced = media.matches; schedule(); };
    document.addEventListener("visibilitychange", onVisibility);
    media.addEventListener("change", onMotion);

    /* Canvas paint never requests a webfont — it draws whatever happens to be loaded at that
       instant, so a constellation name could quietly land on the Georgia fallback while the
       DOM around it wears the kit. Ask for the two exact specs this file paints with, the
       italic one being daith-vf's true italic cut, and redraw when they arrive. fonts.ready
       on its own settles before a face nobody has requested joins the loaded set. */
    const warmFaces = () => {
      void Promise.all([
        document.fonts.load(`italic 15px ${displayFont}`),
        document.fonts.load(`14px ${displayFont}`),
      ]).finally(schedule);
    };
    warmFaces();
    void document.fonts.ready.then(warmFaces);

    schedule();

    return () => {
      live = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); invalidate.current = () => { };
      document.removeEventListener("visibilitychange", onVisibility); media.removeEventListener("change", onMotion);
      if (interactive) {
        canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onCancel);
        canvas.removeEventListener("pointerleave", onLeave); canvas.removeEventListener("keydown", onKey);
        canvas.removeEventListener("wheel", onWheel);
      }
    };
  }, []);

  if (preview) return <canvas ref={canvasRef} className="sky-canvas" data-preview="true" aria-hidden="true" tabIndex={-1} />;
  return <>
    <canvas ref={canvasRef} className="sky-canvas" tabIndex={0} role="application"
      aria-label="Your sky. Click a star to read it, or a constellation's name to focus it. Arrow keys browse stars, Enter reads one, plus and minus zoom, zero recentres." />
    <span ref={announcement} className="sr-only" aria-live="polite" />
  </>;
});
export default SkyCanvas;
