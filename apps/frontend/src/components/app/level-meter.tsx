import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface LevelMeterProps {
  level: number | null; // dB value (-60 to 0)
  className?: string;
}

/**
 * Converts dB level to percentage (0-100)
 * -60dB = 0%, 0dB = 100%
 */
function dbToPercent(db: number): number {
  // Clamp to -60 to 0 range
  const clamped = Math.max(-60, Math.min(0, db));
  // Convert to 0-100 percentage
  return ((clamped + 60) / 60) * 100;
}

export function LevelMeter({ level, className }: LevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    // Draw level bar if we have a value
    if (level !== null) {
      const percent = dbToPercent(level);
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
      const tickPositions = [0.25, 0.5, 0.75]; // 25%, 50%, 75%
      for (const pos of tickPositions) {
        const x = rect.width * pos;
        ctx.fillRect(x - 0.5, 0, 1, rect.height);
      }
    }
  }, [level]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("h-2 w-full rounded-sm", className)}
      style={{ width: "100%", height: "8px" }}
    />
  );
}
