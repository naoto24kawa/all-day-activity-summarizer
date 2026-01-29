import { AlertCircle, Chrome, Monitor } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ScreenShareGuideProps {
  className?: string;
}

/**
 * システム音声キャプチャのための画面共有ガイダンス。
 * macOS での制約と手順を説明する。
 */
export function ScreenShareGuide({ className }: ScreenShareGuideProps) {
  return (
    <Alert className={className}>
      <Monitor className="h-4 w-4" />
      <AlertDescription className="space-y-3">
        <p className="font-medium">システム音声キャプチャについて</p>
        <p className="text-sm">
          ブラウザでシステム音声をキャプチャするには、画面共有機能を使用します。
        </p>

        <div className="space-y-2">
          <p className="text-sm font-medium">手順:</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>「システム音声を開始」ボタンをクリック</li>
            <li>画面共有ダイアログで「Chrome タブ」を選択</li>
            <li>音声を録音したいタブを選択</li>
            <li>「システム音声を共有」にチェックを入れる</li>
            <li>「共有」をクリック</li>
          </ol>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-muted p-2">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">macOS の制限:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              <li>画面全体のシステム音声は取得できません</li>
              <li>Chrome タブの音声のみキャプチャ可能です</li>
              <li>YouTube、Spotify Web などのタブ音声に対応</li>
            </ul>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Chrome className="h-4 w-4" />
          <span>Chrome ブラウザが必要です</span>
        </div>
      </AlertDescription>
    </Alert>
  );
}
