---
name: complete-tasks
description: Analyzes in-progress tasks against codebase and marks fully completed ones as done. Use when reviewing active work, saying "完了タスクを確認", "進行中タスクを精査", "終わったタスクを完了にして".
disable-model-invocation: true
context: fork
agent: Explore
---

# Complete Finished Tasks

Compares in-progress tasks with codebase implementation and marks completed ones as done.

## Prerequisites

- API server running on port 3001 (or specify port)
- Task API available at `/api/tasks`

## Workflow

### Step 1: Fetch In-Progress Tasks

Retrieve all tasks currently in progress.

```bash
curl -s "http://localhost:3001/api/tasks?status=in_progress" | jq '.[] | {id, title, description, startedAt}'
```

**Verification**: Task list is returned with details.

**Error Handling**:
- Connection refused: Ask user for correct port
- Empty response: Report "No in-progress tasks" and exit

### Step 2: Investigate Completion Status

For each task, check if implementation is complete:

| Criterion | Check |
|-----------|-------|
| Functionality | All described features exist in code |
| Tests | Related tests pass (if applicable) |
| UI Components | Components exist and render correctly |
| API Endpoints | Endpoints are implemented and functional |

Classify each task:
- **Completed**: All requirements met
- **In Progress**: Some work remains
- **Blocked**: Depends on incomplete task

**Verification**: Each task has clear status with evidence.

### Step 3: Report Findings

Present results in this format:

```markdown
## ✅ Completed (Ready to Close) - N items

| ID | Task | Completion Evidence |
|----|------|---------------------|
| XX | Task title | All features in file.ts:100-200 |

## 🔄 Still In Progress - M items

| ID | Task | Remaining Work |
|----|------|----------------|
| YY | Task title | UI component needs styling |

## ⛔ Blocked - K items

| ID | Task | Blocker |
|----|------|---------|
| ZZ | Task title | Depends on task #XX |
```

**Verification**: User acknowledges findings before proceeding.

### Step 4: Mark as Complete

After user confirms with "完了にして" or "complete":

```bash
for id in ID1 ID2 ID3; do
  curl -s -X POST "http://localhost:3001/api/tasks/$id/complete"
  echo "Completed task $id"
done
```

**Verification**: Each API call returns success.

**Error Handling**:
- 404: Task not found, skip and report
- 400: Invalid state transition, report error

### Step 5: Report Summary

```bash
curl -s "http://localhost:3001/api/tasks/stats" | jq '{in_progress, completed}'
```

```markdown
## Summary

- Tasks marked complete: N
- Remaining in progress: M
- Blocked tasks: K
```

## Completion Criteria

### Mark as Complete When:
- All functionality described in title/description is implemented
- Related tests exist and pass
- UI components render and function correctly
- API endpoints respond as expected
- No known bugs remain

### Keep In Progress When:
- Partial implementation only
- "Research" or "Design" tasks without conclusion
- Blocked by other incomplete tasks
- Known issues remain

## Important Notes

- **Never mark complete without explicit user confirmation**
- Blocked tasks should never be marked complete
- Report blockers so user can prioritize
- Use parallel exploration for efficiency
