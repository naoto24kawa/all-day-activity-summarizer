import { cn } from "@/lib/utils";

interface BrowserLevelMeterProps {
  /** 音声レベル (0-1) */
  level: number;
  className?: string;
}

/**
 * ブラウザ録音用の簡易レベルメーター。
 * 0-1 の範囲の値を受け取り、カラーバーで表示する。
 */
export function BrowserLevelMeter({ level, className }: BrowserLevelMeterProps) {
  const percent = Math.min(100, Math.max(0, level * 100));

  // レベルに応じた色
  const getBarColor = () => {
    if (percent > 80) return "bg-red-500";
    if (percent > 50) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-sm bg-zinc-800", className)}>
      <div
        className={cn("h-full transition-all duration-75", getBarColor())}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
