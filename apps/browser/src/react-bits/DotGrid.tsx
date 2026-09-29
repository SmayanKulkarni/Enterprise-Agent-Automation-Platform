import { useEffect, useMemo, useRef, useCallback } from 'react';
import { gsap } from 'gsap';
import { InertiaPlugin } from 'gsap/InertiaPlugin';

gsap.registerPlugin(InertiaPlugin);

interface Dot { cx: number; cy: number; xOffset: number; yOffset: number; inertiaApplied: boolean }

interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  resistance?: number;
  returnDuration?: number;
  className?: string;
}

const hexToRgb = (hex: string) => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match ? { r: parseInt(match[1]!, 16), g: parseInt(match[2]!, 16), b: parseInt(match[3]!, 16) } : { r: 0, g: 0, b: 0 };
};

export default function DotGrid({ dotSize = 4, gap = 26, baseColor = '#d3d8cf', activeColor = '#789f1d', proximity = 140, speedTrigger = 100, shockRadius = 250, shockStrength = 5, maxSpeed = 5000, resistance = 750, returnDuration = 1.5, className = '' }: DotGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const visibleRef = useRef(true);
  const pointerRef = useRef({ x: -9999, y: -9999, lastTime: 0, lastX: 0, lastY: 0 });
  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor]);
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor]);
  const circlePath = useMemo(() => {
    const path = new Path2D();
    path.arc(0, 0, dotSize / 2, 0, Math.PI * 2);
    return path;
  }, [dotSize]);

  const buildGrid = useCallback(() => {
    const wrap = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const { width, height } = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext('2d')?.scale(dpr, dpr);
    const cell = dotSize + gap;
    const cols = Math.floor((width + gap) / cell);
    const rows = Math.floor((height + gap) / cell);
    const startX = (width - (cell * cols - gap)) / 2 + dotSize / 2;
    const startY = (height - (cell * rows - gap)) / 2 + dotSize / 2;
    dotsRef.current = Array.from({ length: cols * rows }, (_, index) => ({ cx: startX + (index % cols) * cell, cy: startY + Math.floor(index / cols) * cell, xOffset: 0, yOffset: 0, inertiaApplied: false }));
  }, [dotSize, gap]);

  useEffect(() => {
    let frame = 0;
    const proximitySquared = proximity * proximity;
    const draw = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context && visibleRef.current) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        const { x: px, y: py } = pointerRef.current;
        for (const dot of dotsRef.current) {
          const dx = dot.cx - px;
          const dy = dot.cy - py;
          const distanceSquared = dx * dx + dy * dy;
          let fill = baseColor;
          if (distanceSquared <= proximitySquared) {
            const t = 1 - Math.sqrt(distanceSquared) / proximity;
            fill = `rgb(${Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t)},${Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t)},${Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t)})`;
          }
          context.save();
          context.translate(dot.cx + dot.xOffset, dot.cy + dot.yOffset);
          context.fillStyle = fill;
          context.fill(circlePath);
          context.restore();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [proximity, baseColor, activeRgb, baseRgb, circlePath]);

  useEffect(() => {
    buildGrid();
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const resize = new ResizeObserver(buildGrid);
    const visibility = new IntersectionObserver(([entry]) => { visibleRef.current = entry?.isIntersecting ?? true; });
    resize.observe(wrap);
    visibility.observe(wrap);
    return () => { resize.disconnect(); visibility.disconnect(); };
  }, [buildGrid]);

  useEffect(() => {
    const push = (dot: Dot, x: number, y: number) => {
      dot.inertiaApplied = true;
      gsap.killTweensOf(dot);
      gsap.to(dot, {
        inertia: { xOffset: x, yOffset: y, resistance },
        onComplete: () => {
          gsap.to(dot, { xOffset: 0, yOffset: 0, duration: returnDuration, ease: 'elastic.out(1,0.75)' });
          dot.inertiaApplied = false;
        },
      });
    };
    let lastCall = 0;
    const onMove = (event: MouseEvent) => {
      const now = performance.now();
      if (now - lastCall < 50) return;
      lastCall = now;
      const pointer = pointerRef.current;
      const dt = pointer.lastTime ? now - pointer.lastTime : 16;
      let vx = ((event.clientX - pointer.lastX) / dt) * 1000;
      let vy = ((event.clientY - pointer.lastY) / dt) * 1000;
      let speed = Math.hypot(vx, vy);
      if (speed > maxSpeed) {
        vx *= maxSpeed / speed;
        vy *= maxSpeed / speed;
        speed = maxSpeed;
      }
      pointer.lastTime = now;
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      for (const dot of dotsRef.current) {
        if (speed > speedTrigger && Math.hypot(dot.cx - pointer.x, dot.cy - pointer.y) < proximity && !dot.inertiaApplied) push(dot, dot.cx - pointer.x + vx * 0.005, dot.cy - pointer.y + vy * 0.005);
      }
    };
    const onClick = (event: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      for (const dot of dotsRef.current) {
        const distance = Math.hypot(dot.cx - x, dot.cy - y);
        if (distance < shockRadius && !dot.inertiaApplied) {
          const falloff = Math.max(0, 1 - distance / shockRadius);
          push(dot, (dot.cx - x) * shockStrength * falloff, (dot.cy - y) * shockStrength * falloff);
        }
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick);
    };
  }, [maxSpeed, speedTrigger, proximity, resistance, returnDuration, shockRadius, shockStrength]);

  return <div ref={wrapperRef} className={`dot-grid ${className}`} aria-hidden="true"><canvas ref={canvasRef} className="dot-grid-canvas" /></div>;
}
