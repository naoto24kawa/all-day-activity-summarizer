/**
 * Learning Edit Dialog
 *
 * Dialog for creating and editing learnings
 */

import type { Learning, Project } from "@repo/types";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface LearningEditDialogProps {
  open: boolean;
  learning?: Learning | null; // null = create mode
  projects: Project[];
  onSubmit: (data: {
    content: string;
    category?: string | null;
    tags?: string[];
    projectId?: number | null;
  }) => Promise<void>;
  onCancel: () => void;
}

export function LearningEditDialog({
  open,
  learning,
  projects,
  onSubmit,
  onCancel,
}: LearningEditDialogProps) {
  const isEditMode = !!learning;

  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [submitting, setSubmitting] = useState(false);

  // Reset form when dialog opens/closes or learning changes
  useEffect(() => {
    if (open && learning) {
      setContent(learning.content);
      setCategory(learning.category ?? "");
      setTagsInput(learning.tags ? JSON.parse(learning.tags).join(", ") : "");
      setProjectId(learning.projectId?.toString() ?? "none");
    } else if (open && !learning) {
      setContent("");
      setCategory("");
      setTagsInput("");
      setProjectId("none");
    }
  }, [open, learning]);

  const handleSubmit = async () => {
    if (!content.trim()) return;

    setSubmitting(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      await onSubmit({
        content: content.trim(),
        category: category.trim() || null,
        tags: tags.length > 0 ? tags : undefined,
        projectId: projectId === "none" ? null : Number.parseInt(projectId, 10),
      });

      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setContent("");
    setCategory("");
    setTagsInput("");
    setProjectId("none");
    onCancel();
  };

  // Cmd/Ctrl+Enter to submit
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!submitting && content.trim()) {
          handleSubmit();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Learning" : "Add Learning"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "学びの内容を編集します"
              : "新しい学びを手動で追加します。Cmd/Ctrl+Enter で保存できます。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="content">内容 *</Label>
            <Textarea
              id="content"
              placeholder="学んだことを入力..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">カテゴリ</Label>
            <Input
              id="category"
              placeholder="例: typescript, react, architecture"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">タグ (カンマ区切り)</Label>
            <Input
              id="tags"
              placeholder="例: tips, error-handling, best-practice"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project">プロジェクト</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="プロジェクトを選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">なし</SelectItem>
                {projects
                  .filter((p) => p.isActive)
                  .map((project) => (
                    <SelectItem key={project.id} value={project.id.toString()}>
                      {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !content.trim()}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? "更新" : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
