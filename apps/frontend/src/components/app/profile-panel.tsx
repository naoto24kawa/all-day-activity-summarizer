import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile, useProfileSuggestions } from "@/hooks/use-profile";

export function ProfilePanel() {
  const { profile, specialties, knownTechnologies, learningGoals, loading, error, updateProfile } =
    useProfile();
  const { generating, generateSuggestions } = useProfileSuggestions();

  const [experienceYears, setExperienceYears] = useState<string>("");
  const [newSpecialty, setNewSpecialty] = useState("");
  const [newTechnology, setNewTechnology] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [updating, setUpdating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ count: number } | null>(null);

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Profile Settings</CardTitle>
          <CardDescription>
            プロフィール情報は学び抽出時に参照されます。提案は Tasks タブに表示されます。
          </CardDescription>
        </div>
        <Button onClick={handleGenerateSuggestions} disabled={generating} size="sm">
          {generating ? "生成中..." : "提案を生成"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {generateResult && (
          <p className="text-sm text-muted-foreground">
            {generateResult.count} 件の提案を生成しました。Tasks タブで確認してください。
          </p>
        )}

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
