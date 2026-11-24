"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Accent = "teal" | "blue" | "amber" | "violet";
type Speed = "slow" | "balanced" | "fast";
type Settings = { accent: Accent; speed: Speed; density: number; showClock: boolean; reduceMotion: boolean };
type Particle = { x: number; y: number; phase: number; speed: number; radius: number };

const PALETTES: Record<Accent, { label: string; rgb: string; hex: string }> = {
  teal: { label: "FINVANTA teal", rgb: "16, 185, 129", hex: "#10b981" },
  blue: { label: "Electric blue", rgb: "56, 189, 248", hex: "#38bdf8" },
  amber: { label: "Warm amber", rgb: "245, 158, 11", hex: "#f59e0b" },
  violet: { label: "Soft violet", rgb: "167, 139, 250", hex: "#a78bfa" },
};

const ACCENTS: Accent[] = ["teal", "blue", "amber", "violet"];
const SPEED_OPTIONS: Speed[] = ["slow", "balanced", "fast"];
const SPEEDS: Record<Speed, number> = { slow: 0.45, balanced: 1, fast: 1.65 };
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

export default function ScreensaverExperience() {
  const surfaceRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settings, setSettings] = useState<Settings>({
    accent: "teal",
    speed: "balanced",
    density: 60,
    showClock: true,
    reduceMotion: false,
  });
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const systemReducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, serverMotionPreference);
  const reducedMotion = settings.reduceMotion || systemReducedMotion;

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === surfaceRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !surface || !context) {
      setError("Canvas animation is unavailable in this browser. You can still use the clock and screen controls.");
      return;
    }

    setError("");
    const palette = PALETTES[settings.accent];
    const speed = SPEEDS[settings.speed];
    const particles: Particle[] = Array.from({ length: settings.density }, () => ({
      x: Math.random(),
      y: Math.random(),
      phase: Math.random() * Math.PI * 2,
      speed: 0.008 + Math.random() * 0.024,
      radius: 0.8 + Math.random() * 1.7,
    }));
    let width = 0;
    let height = 0;
    let lastFrame = 0;
    let animationFrame = 0;

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const background = context.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#07101f");
      background.addColorStop(0.55, "#09182a");
      background.addColorStop(1, "#050b15");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const glow = context.createRadialGradient(width * 0.52, height * 0.54, 8, width * 0.52, height * 0.54, Math.max(width, height) * 0.55);
      glow.addColorStop(0, `rgba(${palette.rgb}, 0.12)`);
      glow.addColorStop(1, "rgba(7, 16, 31, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      context.lineWidth = 1;
      context.strokeStyle = "rgba(148, 163, 184, 0.055)";
      const gridSize = 58;
      for (let x = gridSize; x < width; x += gridSize) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = gridSize; y < height; y += gridSize) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      context.beginPath();
      context.ellipse(width * 0.52, height * 0.56, width * 0.38, height * 0.19, -0.12, 0, Math.PI * 2);
      context.strokeStyle = `rgba(${palette.rgb}, 0.18)`;
      context.stroke();

      const elapsed = time * 0.001 * speed;
      for (let wave = 0; wave < 3; wave++) {
        context.beginPath();
        for (let step = 0; step <= 100; step++) {
          const x = (step / 100) * width;
          const phase = (step / 100) * Math.PI * 3.2 + elapsed * (0.45 + wave * 0.12) + wave * 1.8;
          const y = height * (0.48 + wave * 0.055) + Math.sin(phase) * height * 0.055;
          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = `rgba(${palette.rgb}, ${0.12 - wave * 0.025})`;
        context.lineWidth = wave === 0 ? 1.5 : 1;
        context.stroke();
      }

      const points = particles.map((particle) => ({
        x: ((particle.x + elapsed * particle.speed) % 1) * width,
        y: particle.y * height + Math.sin(elapsed + particle.phase) * 18,
        radius: particle.radius,
      }));
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const other = points[j];
          const dx = point.x - other.x;
          const dy = point.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 118) {
            context.beginPath();
            context.moveTo(point.x, point.y);
            context.lineTo(other.x, other.y);
            context.strokeStyle = `rgba(${palette.rgb}, ${(1 - distance / 118) * 0.17})`;
            context.lineWidth = 0.8;
            context.stroke();
          }
        }
        context.beginPath();
        context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${palette.rgb}, 0.82)`;
        context.shadowBlur = 12;
        context.shadowColor = palette.hex;
        context.fill();
        context.shadowBlur = 0;
      }
    };

    const resize = () => {
      const bounds = surface.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      draw(lastFrame);
    };

    const stop = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const animate = (timestamp: number) => {
      if (timestamp - lastFrame >= 1000 / 30) {
        lastFrame = timestamp;
        draw(timestamp);
      }
      animationFrame = window.requestAnimationFrame(animate);
    };
    const start = () => {
      stop();
      draw(lastFrame);
      if (!paused && !reducedMotion && document.visibilityState === "visible") {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };

    resize();
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [paused, reducedMotion, settings.accent, settings.density, settings.speed]);

  async function toggleFullscreen() {
    const surface = surfaceRef.current;
    if (!surface) return;
    setError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await surface.requestFullscreen();
    } catch (cause) {
      setError(cause instanceof Error ? `Fullscreen unavailable: ${cause.message}` : "Fullscreen is unavailable in this browser.");
    }
  }

  const clock = now
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now)
    : "";
  const date = now
    ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now)
    : "";

  return (
    <section
      ref={surfaceRef}
      aria-label="FINVANTA ambient screensaver"
      className={`relative isolate min-h-[34rem] overflow-hidden rounded-2xl border border-line bg-[#07101f] text-white ${fullscreen ? "h-screen rounded-none border-0" : "h-[calc(100vh-13rem)]"}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#07101f]/20 via-transparent to-[#050b15]/65" />
      <div className="absolute inset-0 flex flex-col justify-between p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.22em] text-white/90">FINVANTA</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/50">Ambient financial dataflow</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard" className="rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-white/75 transition hover:border-white/35 hover:text-white">
              Back to dashboard
            </Link>
            <button type="button" className="rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-white/75 transition hover:border-white/35 hover:text-white" onClick={() => void toggleFullscreen()}>
              {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            </button>
          </div>
        </header>

        <div className="pointer-events-none text-center">
          {settings.showClock && (
            <>
              <time className="block text-6xl font-light tracking-[-0.06em] text-white/90 sm:text-8xl lg:text-9xl" dateTime={now?.toISOString()}>
                {clock || " "}
              </time>
              <p className="mt-3 text-xs tracking-[0.2em] text-white/55 sm:text-sm">{date}</p>
            </>
          )}
          <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.32em] text-white/45 sm:text-xs">
            Financial clarity, in motion
          </p>
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-white/75">{paused ? "Animation paused" : reducedMotion ? "Reduced motion" : "Ambient mode active"}</p>
            <p className="mt-1 text-[10px] text-white/45">Abstract animation only · no company records or financial figures displayed</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-white/75 transition hover:border-white/35 hover:text-white" onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
              {paused ? "Resume motion" : "Pause motion"}
            </button>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-white/75 transition hover:border-white/35 hover:text-white">
                Customize
              </summary>
              <div className="absolute bottom-11 right-0 z-10 w-64 space-y-3 rounded-xl border border-white/15 bg-[#0b1524]/95 p-4 shadow-2xl backdrop-blur">
                <label className="block text-xs text-white/75">
                  Accent palette
                  <select className="mt-1.5 w-full rounded-md border border-white/15 bg-[#07101f] px-2 py-1.5 text-xs text-white" value={settings.accent} onChange={(event) => {
                    const selected = ACCENTS.find((accent) => accent === event.target.value);
                    if (selected) setSettings((current) => ({ ...current, accent: selected }));
                  }}>
                    {ACCENTS.map((accent) => <option key={accent} value={accent}>{PALETTES[accent].label}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-white/75">
                  Animation speed
                  <select className="mt-1.5 w-full rounded-md border border-white/15 bg-[#07101f] px-2 py-1.5 text-xs text-white" value={settings.speed} disabled={reducedMotion} onChange={(event) => {
                    const selected = SPEED_OPTIONS.find((speedOption) => speedOption === event.target.value);
                    if (selected) setSettings((current) => ({ ...current, speed: selected }));
                  }}>
                    {SPEED_OPTIONS.map((speedOption) => <option key={speedOption} value={speedOption}>{speedOption[0].toUpperCase() + speedOption.slice(1)}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-white/75">
                  Particle density <span className="float-right num">{settings.density}</span>
                  <input className="mt-2 w-full accent-emerald-400" type="range" min="24" max="96" step="12" value={settings.density} aria-label="Particle density" onChange={(event) => setSettings((current) => ({ ...current, density: Number(event.target.value) }))} />
                </label>
                <label className="flex items-center gap-2 text-xs text-white/75">
                  <input type="checkbox" checked={settings.showClock} onChange={(event) => setSettings((current) => ({ ...current, showClock: event.target.checked }))} />
                  Show clock
                </label>
                <label className="flex items-center gap-2 text-xs text-white/75">
                  <input type="checkbox" checked={settings.reduceMotion} onChange={(event) => setSettings((current) => ({ ...current, reduceMotion: event.target.checked }))} />
                  Reduce motion
                </label>
                {systemReducedMotion && <p className="text-[10px] leading-relaxed text-white/50">Your device prefers reduced motion; animation remains still unless you change that system setting.</p>}
              </div>
            </details>
          </div>
        </footer>
      </div>
      {error && <p role="alert" className="absolute left-4 top-20 max-w-lg rounded-lg border border-red-300/30 bg-black/70 px-3 py-2 text-xs text-red-100">{error}</p>}
    </section>
  );
}
