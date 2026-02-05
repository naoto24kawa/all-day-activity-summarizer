import {
  Briefcase,
  Github,
  Info,
  Lightbulb,
  MessageSquare,
  Plus,
  Sparkles,
  Target,
  User,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProfile, useProfileSuggestions } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";

interface ProfilePanelProps {
  className?: string;
}

export function ProfilePanel({ className }: ProfilePanelProps) {
  const {
    profile,
    responsibilities,
    specialties,
    knownTechnologies,
    learningGoals,
    loading,
    error,
    updateProfile,
  } = useProfile();
  const { generating, generateSuggestions } = useProfileSuggestions();

  // 基本情報
  const [displayName, setDisplayName] = useState<string>("");
  const [slackUserId, setSlackUserId] = useState<string>("");
  const [githubUsername, setGithubUsername] = useState<string>("");
  // 役割・責任
  const [newResponsibility, setNewResponsibility] = useState("");
  // 技術スキル
  const [experienceYears, setExperienceYears] = useState<string>("");
  const [newSpecialty, setNewSpecialty] = useState("");
  const [newTechnology, setNewTechnology] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [updating, setUpdating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ count: number } | null>(null);

  // プロフィールが読み込まれたら値を設定
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? "");
      setSlackUserId(profile.slackUserId ?? "");
      setGithubUsername(profile.githubUsername ?? "");
      if (profile.experienceYears !== null && profile.experienceYears !== undefined) {
        setExperienceYears(profile.experienceYears.toString());
      }
    }
  }, [profile]);

  const handleUpdateBasicInfo = async () => {
    setUpdating(true);
    try {
      await updateProfile({
        displayName: displayName.trim() || null,
        slackUserId: slackUserId.trim() || null,
        githubUsername: githubUsername.trim() || null,
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateExperience = async () => {
    const years = experienceYears.trim() ? Number.parseInt(experienceYears, 10) : null;
    if (years !== null && Number.isNaN(years)) return;

    setUpdating(true);
    try {
      await updateProfile({ experienceYears: years });
    } finally {
      setUpdating(false);
    }
  };

  const handleAddItem = async (
    field: "responsibilities" | "specialties" | "knownTechnologies" | "learningGoals",
    value: string,
    currentArray: string[],
    clearFn: () => void,
  ) => {
    if (!value.trim()) return;
    if (currentArray.includes(value.trim())) return;

    setUpdating(true);
    try {
      await updateProfile({ [field]: [...currentArray, value.trim()] });
      clearFn();
    } finally {
      setUpdating(false);
    }
  };

  const handleRemoveItem = async (
    field: "responsibilities" | "specialties" | "knownTechnologies" | "learningGoals",
    value: string,
    currentArray: string[],
  ) => {
    setUpdating(true);
    try {
      await updateProfile({ [field]: currentArray.filter((v) => v !== value) });
    } finally {
      setUpdating(false);
    }
  };

  const handleGenerateSuggestions = async () => {
    try {
      const result = await generateSuggestions(7);
      if (result) {
        setGenerateResult({ count: result.generated });
        setTimeout(() => setGenerateResult(null), 5000);
      }
    } catch (err) {
      console.error("Failed to generate suggestions:", err);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5 text-orange-500" />
          Profile Settings
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p>プロフィール情報は学び抽出時に参照されます。</p>
              <p>提案は Tasks タブに表示されます。</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
        <Button onClick={handleGenerateSuggestions} disabled={generating} size="sm">
          <Sparkles className={`mr-1 h-3 w-3 ${generating ? "animate-pulse" : ""}`} />
          {generating ? "生成中..." : "提案を生成"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {generateResult && (
          <p className="text-sm text-muted-foreground">
            {generateResult.count} 件の提案を生成しました。Tasks タブで確認してください。
          </p>
        )}

        {/* 基本情報 */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-base font-semibold">
            <User className="h-4 w-4 text-orange-500" />
            基本情報
          </Label>
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="displayName" className="w-24 shrink-0 text-sm">
                名前
              </Label>
              <Input
                id="displayName"
                placeholder="例: 西川、にしかわ、nishikawa"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="flex-1"
                disabled={updating}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="slackUserId"
                className="flex w-24 shrink-0 items-center gap-1 text-sm"
              >
                <MessageSquare className="h-3 w-3" />
                Slack ID
              </Label>
              <Input
                id="slackUserId"
                placeholder="例: U12345678"
                value={slackUserId}
                onChange={(e) => setSlackUserId(e.target.value)}
                className="flex-1"
                disabled={updating}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="githubUsername"
                className="flex w-24 shrink-0 items-center gap-1 text-sm"
              >
                <Github className="h-3 w-3" />
                GitHub
              </Label>
              <Input
                id="githubUsername"
                placeholder="例: naoto24kawa"
                value={githubUsername}
                onChange={(e) => setGithubUsername(e.target.value)}
                className="flex-1"
                disabled={updating}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUpdateBasicInfo}
              disabled={updating}
              className="w-fit"
            >
              基本情報を更新
            </Button>
          </div>
        </div>

        {/* 役割・責任 */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-purple-500" />
            役割・担当 (優先度判定に使用)
          </Label>
          <div className="flex flex-wrap gap-2">
            {responsibilities.map((r) => (
              <Badge
                key={r}
                variant="secondary"
                className="cursor-pointer bg-purple-500/10 hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleRemoveItem("responsibilities", r, responsibilities)}
              >
                {r} ×
              </Badge>
            ))}
            <div className="flex gap-1">
              <Input
                placeholder="追加..."
                value={newResponsibility}
                onChange={(e) => setNewResponsibility(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddItem("responsibilities", newResponsibility, responsibilities, () =>
                      setNewResponsibility(""),
                    );
                  }
                }}
                className="h-6 w-32 text-xs"
                disabled={updating}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() =>
                  handleAddItem("responsibilities", newResponsibility, responsibilities, () =>
                    setNewResponsibility(""),
                  )
                }
                disabled={updating || !newResponsibility.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            例: インフラ担当、レビュアー、ジョブアンテナ、フロントエンド
          </p>
        </div>

        {/* 経験年数 */}
        <div className="space-y-2">
          <Label htmlFor="experience">経験年数</Label>
          <div className="flex gap-2">
            <Input
              id="experience"
              type="number"
              min="0"
              max="50"
              placeholder="例: 5"
              value={experienceYears}
              onChange={(e) => setExperienceYears(e.target.value)}
              className="w-24"
              disabled={updating}
            />
            <span className="self-center text-sm text-muted-foreground">年</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUpdateExperience}
              disabled={updating}
            >
              更新
            </Button>
          </div>
        </div>

        {/* 専門分野 */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            専門分野
          </Label>
          <div className="flex flex-wrap gap-2">
            {specialties.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleRemoveItem("specialties", s, specialties)}
              >
                {s} ×
              </Badge>
            ))}
            <div className="flex gap-1">
              <Input
                placeholder="追加..."
                value={newSpecialty}
                onChange={(e) => setNewSpecialty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddItem("specialties", newSpecialty, specialties, () =>
                      setNewSpecialty(""),
                    );
                  }
                }}
                className="h-6 w-24 text-xs"
                disabled={updating}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() =>
                  handleAddItem("specialties", newSpecialty, specialties, () => setNewSpecialty(""))
                }
                disabled={updating || !newSpecialty.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* 既知の技術 */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-blue-500" />
            既知の技術
          </Label>
          <div className="flex flex-wrap gap-2">
            {knownTechnologies.map((t) => (
              <Badge
                key={t}
                variant="outline"
                className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleRemoveItem("knownTechnologies", t, knownTechnologies)}
              >
                {t} ×
              </Badge>
            ))}
            <div className="flex gap-1">
              <Input
                placeholder="追加..."
                value={newTechnology}
                onChange={(e) => setNewTechnology(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddItem("knownTechnologies", newTechnology, knownTechnologies, () =>
                      setNewTechnology(""),
                    );
                  }
                }}
                className="h-6 w-24 text-xs"
                disabled={updating}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() =>
                  handleAddItem("knownTechnologies", newTechnology, knownTechnologies, () =>
                    setNewTechnology(""),
                  )
                }
                disabled={updating || !newTechnology.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* 学習目標 */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Target className="h-4 w-4 text-green-500" />
            学習目標
          </Label>
          <div className="flex flex-wrap gap-2">
            {learningGoals.map((g) => (
              <Badge
                key={g}
                variant="default"
                className="cursor-pointer hover:bg-destructive"
                onClick={() => handleRemoveItem("learningGoals", g, learningGoals)}
              >
                {g} ×
              </Badge>
            ))}
            <div className="flex gap-1">
              <Input
                placeholder="追加..."
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddItem("learningGoals", newGoal, learningGoals, () => setNewGoal(""));
                  }
                }}
                className="h-6 w-24 text-xs"
                disabled={updating}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() =>
                  handleAddItem("learningGoals", newGoal, learningGoals, () => setNewGoal(""))
                }
                disabled={updating || !newGoal.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
