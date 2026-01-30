import type { ProfileSuggestion, ProfileSuggestionType } from "@repo/types";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile, useProfileSuggestions } from "@/hooks/use-profile";

const SUGGESTION_TYPE_LABELS: Record<ProfileSuggestionType, string> = {
  add_technology: "技術追加",
  add_specialty: "専門分野追加",
  add_goal: "学習目標追加",
  update_experience: "経験年数更新",
};

const FIELD_LABELS: Record<string, string> = {
  specialties: "専門分野",
  knownTechnologies: "技術",
  learningGoals: "学習目標",
  experienceYears: "経験年数",
};

export function ProfilePanel() {
  return (
    <div className="space-y-4">
      <ProfileSettings />
      <ProfileSuggestionsPanel />
    </div>
  );
}

function ProfileSettings() {
  const { profile, specialties, knownTechnologies, learningGoals, loading, error, updateProfile } =
    useProfile();

  const [experienceYears, setExperienceYears] = useState<string>("");
  const [newSpecialty, setNewSpecialty] = useState("");
  const [newTechnology, setNewTechnology] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [updating, setUpdating] = useState(false);

  // プロフィールが読み込まれたら経験年数を設定
  useState(() => {
    if (profile?.experienceYears !== null && profile?.experienceYears !== undefined) {
      setExperienceYears(profile.experienceYears.toString());
    }
  });

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
    field: "specialties" | "knownTechnologies" | "learningGoals",
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
    field: "specialties" | "knownTechnologies" | "learningGoals",
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
    <Card>
      <CardHeader>
        <CardTitle>Profile Settings</CardTitle>
        <CardDescription>
          プロフィール情報は学び抽出時に参照され、既知の技術の基礎的な内容を除外し、学習目標に関連する内容を優先します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
          <Label>専門分野</Label>
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
                +
              </Button>
            </div>
          </div>
        </div>

        {/* 既知の技術 */}
        <div className="space-y-2">
          <Label>既知の技術</Label>
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
                +
              </Button>
            </div>
          </div>
        </div>

        {/* 学習目標 */}
        <div className="space-y-2">
          <Label>学習目標</Label>
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
                +
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileSuggestionsPanel() {
  const {
    pendingSuggestions,
    loading,
    error,
    generating,
    acceptSuggestion,
    rejectSuggestion,
    generateSuggestions,
  } = useProfileSuggestions();

  const { fetchProfile } = useProfile();

  const [processing, setProcessing] = useState<number | null>(null);

  const handleAccept = async (suggestion: ProfileSuggestion) => {
    setProcessing(suggestion.id);
    try {
      await acceptSuggestion(suggestion.id);
      await fetchProfile(); // プロフィールを再取得
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (suggestion: ProfileSuggestion) => {
    setProcessing(suggestion.id);
    try {
      await rejectSuggestion(suggestion.id);
    } finally {
      setProcessing(null);
    }
  };

  const handleGenerate = async () => {
    try {
      await generateSuggestions(7);
    } catch (err) {
      console.error("Failed to generate suggestions:", err);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profile Suggestions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>
            Profile Suggestions
            {pendingSuggestions.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendingSuggestions.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>活動データから自動生成されたプロフィール提案</CardDescription>
        </div>
        <Button onClick={handleGenerate} disabled={generating} size="sm">
          {generating ? "生成中..." : "提案を生成"}
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {pendingSuggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            承認待ちの提案はありません。「提案を生成」をクリックして活動データから提案を生成してください。
          </p>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {pendingSuggestions.map((suggestion) => (
                <SuggestionItem
                  key={suggestion.id}
                  suggestion={suggestion}
                  onAccept={() => handleAccept(suggestion)}
                  onReject={() => handleReject(suggestion)}
                  processing={processing === suggestion.id}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function SuggestionItem({
  suggestion,
  onAccept,
  onReject,
  processing,
}: {
  suggestion: ProfileSuggestion;
  onAccept: () => void;
  onReject: () => void;
  processing: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {SUGGESTION_TYPE_LABELS[suggestion.suggestionType]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {FIELD_LABELS[suggestion.field] || suggestion.field}
            </span>
          </div>
          <p className="font-medium">{suggestion.value}</p>
          {suggestion.reason && (
            <p className="text-sm text-muted-foreground">{suggestion.reason}</p>
          )}
          {suggestion.confidence !== null && (
            <p className="text-xs text-muted-foreground">
              確信度: {Math.round(suggestion.confidence * 100)}%
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onAccept} disabled={processing}>
            承認
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onReject}
            disabled={processing}
            className="text-muted-foreground hover:text-destructive"
          >
            却下
          </Button>
        </div>
      </div>
    </div>
  );
}
