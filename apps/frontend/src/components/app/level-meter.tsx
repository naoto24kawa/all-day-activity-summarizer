import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface LevelMeterProps {
  level: number | null; // dB value (-60 to 0)
  className?: string;
  decayRate?: number; // dB per second (default: 30)
}

/**
 * Converts dB level to percentage (0-100)
 * -60dB = 0%, 0dB = 100%
 */
function dbToPercent(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db));
  return ((clamped + 60) / 60) * 100;
}

export function LevelMeter({ level, className, decayRate = 30 }: LevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayLevelRef = useRef<number>(-60);
  const lastTimeRef = useRef<number>(0);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (timestamp: number) => {
      const deltaTime = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = timestamp;

      // Update display level with decay
      const targetLevel = level ?? -60;
      if (targetLevel > displayLevelRef.current) {
        // Rise instantly
        displayLevelRef.current = targetLevel;
      } else {
        // Decay gradually
        const decay = decayRate * deltaTime;
        displayLevelRef.current = Math.max(targetLevel, displayLevelRef.current - decay);
      }

      // Get device pixel ratio for sharp rendering
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      // Set canvas size with pixel ratio
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      // Clear canvas
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Draw background
      ctx.fillStyle = "#27272a"; // zinc-800
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Draw level bar
      const percent = dbToPercent(displayLevelRef.current);
      const barWidth = (rect.width * percent) / 100;

      // Create gradient (green to yellow to red)
      const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
      gradient.addColorStop(0, "#22c55e"); // green-500
      gradient.addColorStop(0.6, "#22c55e"); // green-500
      gradient.addColorStop(0.8, "#eab308"); // yellow-500
      gradient.addColorStop(1, "#ef4444"); // red-500

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, barWidth, rect.height);

      // Draw tick marks
      ctx.fillStyle = "#52525b"; // zinc-600
      const tickPositions = [0.25, 0.5, 0.75];
      for (const pos of tickPositions) {
        const x = rect.width * pos;
        ctx.fillRect(x - 0.5, 0, 1, rect.height);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [level, decayRate]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("h-2 w-full rounded-sm", className)}
      style={{ width: "100%", height: "8px" }}
    />
  );
}
