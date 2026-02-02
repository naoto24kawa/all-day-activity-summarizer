import { Check, FileText, Info, Loader2, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type PromptImprovement,
  useApproveImprovement,
  useGenerateImprovement,
  usePromptImprovementStats,
  usePromptImprovements,
  useRejectImprovement,
} from "@/hooks/use-prompt-improvements";

const TARGET_LABELS: Record<string, string> = {
  interpret: "AI 解釈",
  evaluate: "ハルシネーション評価",
  "summarize-times": "時間範囲サマリ",
  "summarize-daily": "日次サマリ",
  "task-extract": "タスク抽出",
};

export function PromptImprovementsPanel() {
  const [selectedImprovement, setSelectedImprovement] = useState<PromptImprovement | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [generatingTarget, setGeneratingTarget] = useState<string | null>(null);

  const { stats, refetch: refetchStats } = usePromptImprovementStats();
  const { improvements: pendingImprovements, refetch: refetchPending } =
    usePromptImprovements("pending");
  const { improvements: allImprovements, refetch: refetchAll } = usePromptImprovements();

  const { generate, generating } = useGenerateImprovement();
  const { approve, approving } = useApproveImprovement();
  const { reject, rejecting } = useRejectImprovement();

  const handleGenerate = async (target: string) => {
    setGeneratingTarget(target);
    const result = await generate(target);
    setGeneratingTarget(null);
    if (result) {
      refetchStats();
      refetchPending();
      refetchAll();
    }
  };

  const handleApprove = async (id: number) => {
    const result = await approve(id);
    if (result) {
      setSelectedImprovement(null);
      setShowDiff(false);
      refetchStats();
      refetchPending();
      refetchAll();
    }
  };

  const handleReject = async (id: number) => {
    const result = await reject(id);
    if (result) {
      setSelectedImprovement(null);
      setShowDiff(false);
      refetchStats();
      refetchPending();
      refetchAll();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          プロンプト改善
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p>フィードバックに基づくプロンプト自動改善</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="pending">
          <TabsList className="w-full">
            <TabsTrigger value="pending" className="flex-1">
              承認待ち
              {pendingImprovements.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {pendingImprovements.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex-1">
              統計
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              履歴
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-3 mt-3">
            {pendingImprovements.length > 0 ? (
              pendingImprovements.map((improvement) => (
                <div key={improvement.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      {TARGET_LABELS[improvement.target] || improvement.target}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      承認待ち
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{improvement.improvementReason}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ThumbsUp className="h-3 w-3 text-green-500" />
                    <span>{improvement.goodCount}</span>
                    <ThumbsDown className="h-3 w-3 text-red-500 ml-1" />
                    <span>{improvement.badCount}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        setSelectedImprovement(improvement);
                        setShowDiff(true);
                      }}
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      差分
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleApprove(improvement.id)}
                      disabled={approving}
                    >
                      {approving ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3 mr-1" />
                      )}
                      承認
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleReject(improvement.id)}
                      disabled={rejecting}
                    >
                      {rejecting ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <X className="h-3 w-3 mr-1" />
                      )}
                      却下
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-center text-sm text-muted-foreground">
                承認待ちの改善提案はありません
              </div>
            )}
          </TabsContent>

          <TabsContent value="stats" className="space-y-3 mt-3">
            {stats &&
              Object.entries(stats).map(([target, stat]) => (
                <div key={target} className="border rounded-lg p-3 space-y-2">
                  <span className="font-medium text-sm">{TARGET_LABELS[target] || target}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3 text-green-500" />
                      <span>{stat.goodCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ThumbsDown className="h-3 w-3 text-red-500" />
                      <span>{stat.badCount}</span>
                    </div>
                    {stat.pendingImprovements > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {stat.pendingImprovements} 件待ち
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleGenerate(target)}
                    disabled={!stat.canGenerate || generating}
                  >
                    {generating && generatingTarget === target ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3 mr-1" />
                    )}
                    改善案を生成
                  </Button>
                  {!stat.canGenerate && stat.badCount < 3 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (悪いフィードバック3件以上必要)
                    </span>
                  )}
                </div>
              ))}
          </TabsContent>

          <TabsContent value="history" className="space-y-3 mt-3">
            <ScrollArea className="h-[200px]">
              {allImprovements.filter((i) => i.status !== "pending").length > 0 ? (
                allImprovements
                  .filter((i) => i.status !== "pending")
                  .map((improvement) => (
                    <div key={improvement.id} className="border rounded-lg p-3 mb-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">
                          {TARGET_LABELS[improvement.target] || improvement.target}
                        </span>
                        <Badge
                          variant={improvement.status === "approved" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {improvement.status === "approved" ? "承認済み" : "却下"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {improvement.improvementReason}
                      </p>
                      <div className="text-xs text-muted-foreground">
                        {improvement.status === "approved" && improvement.approvedAt
                          ? new Date(improvement.approvedAt).toLocaleDateString("ja-JP")
                          : improvement.rejectedAt
                            ? new Date(improvement.rejectedAt).toLocaleDateString("ja-JP")
                            : ""}
                      </div>
                    </div>
                  ))
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  履歴はありません
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <Dialog open={showDiff} onOpenChange={setShowDiff}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>
                プロンプト改善案 -{" "}
                {selectedImprovement &&
                  (TARGET_LABELS[selectedImprovement.target] || selectedImprovement.target)}
              </DialogTitle>
              <DialogDescription>{selectedImprovement?.improvementReason}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-2 text-sm">変更前</h4>
                <ScrollArea className="h-[400px] border rounded p-2">
                  <pre className="text-xs whitespace-pre-wrap">
                    {selectedImprovement?.previousPrompt}
                  </pre>
                </ScrollArea>
              </div>
              <div>
                <h4 className="font-medium mb-2 text-sm">変更後</h4>
                <ScrollArea className="h-[400px] border rounded p-2">
                  <pre className="text-xs whitespace-pre-wrap">
                    {selectedImprovement?.newPrompt}
                  </pre>
                </ScrollArea>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDiff(false)}>
                閉じる
              </Button>
              {selectedImprovement && (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => handleReject(selectedImprovement.id)}
                    disabled={rejecting}
                  >
                    {rejecting ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <X className="h-4 w-4 mr-1" />
                    )}
                    却下
                  </Button>
                  <Button
                    onClick={() => handleApprove(selectedImprovement.id)}
                    disabled={approving}
                  >
                    {approving ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    承認して適用
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
