---
name: cleanup-tasks
description: Analyzes pending tasks against codebase implementation and removes fully implemented ones. Use when cleaning up task backlog, reviewing pending tasks, or saying "実装済みタスクを削除", "タスクの棚卸し", "pending タスクを整理".
disable-model-invocation: true
context: fork
agent: Explore
---

# Cleanup Implemented Tasks

Compares pending tasks with actual codebase implementation and removes tasks that are fully implemented.

## Prerequisites

- API server running on port 3001 (or specify port)
- Task API available at `/api/tasks`

## Workflow

### Step 1: Fetch Pending Tasks

Retrieve all pending tasks from the API.

```bash
curl -s "http://localhost:3001/api/tasks?status=pending" | jq '.[] | "\(.id): \(.title)"' -r
```

**Verification**: Confirm task list is returned. If empty or error, report to user.

**Error Handling**:
- Connection refused: Ask user to confirm API server is running and port number
- Empty response: Report "No pending tasks found" and exit

### Step 2: Categorize and Investigate

Group tasks by category and investigate implementation status using parallel exploration:

| Category | Files to Check |
|----------|---------------|
| Task features | `apps/cli/src/server/routes/tasks.ts`, task extraction, dependencies |
| Learning features | `apps/cli/src/server/routes/learnings.ts`, `learnings-feed.tsx` |
| Vocabulary features | `apps/cli/src/server/routes/vocabulary.ts`, feedback loop |
| Project/Summary | `apps/cli/src/server/routes/projects.ts`, `summarizer/` |
| UI/Frontend | `apps/frontend/src/components/app/` |
| Config/Integration | `apps/cli/src/config.ts`, Slack/GitHub/Claude integration |
| Prompt/Profile | `apps/cli/src/server/routes/prompt-improvements.ts`, `profile.ts` |
| Audio/Whisper | `apps/cli/src/whisper/`, `apps/worker/src/` |

For each task, determine:
- **Implemented**: All described functionality exists in codebase
- **Partial**: Some functionality exists
- **Not Implemented**: No implementation found

**Verification**: Each task has a clear status with evidence (file paths, line numbers).

### Step 3: Report Findings

Present results in this format:

```markdown
## ✅ Implemented (Delete Candidates) - N items

| ID | Task | Evidence |
|----|------|----------|
| XX | Task title | file.ts:100-150 |

## ⚠️ Partial / Not Implemented (Keep) - M items

| ID | Task | Status | Notes |
|----|------|--------|-------|
| YY | Task title | Partial | Missing UI component |
```

**Verification**: User acknowledges the list before proceeding.

### Step 4: Delete After Confirmation

Only proceed when user explicitly confirms with "削除して" or "delete".

```bash
for id in ID1 ID2 ID3; do
  result=$(curl -s -X DELETE "http://localhost:3001/api/tasks/$id")
  echo "Deleted task $id"
done
```

**Verification**: Each deletion returns success response.

**Error Handling**:
- 404: Task already deleted, continue
- 500: Report error, ask user to retry

### Step 5: Report Summary

```bash
remaining=$(curl -s "http://localhost:3001/api/tasks?status=pending" | jq 'length')
echo "Remaining pending tasks: $remaining"
```

## Important Notes

- **Never delete without explicit user confirmation**
- Default API port is 3001; ask user if connection fails
- Use parallel exploration for efficiency (Task tool with Explore agent)
- Report both deleted count and remaining count
