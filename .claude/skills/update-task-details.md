---
name: update-tasks
description: Compares pending tasks with codebase implementation and updates task descriptions and priorities based on findings. Use when refining task details, saying "タスクの詳細を更新", "タスクを実装と比較", "タスク内容を精査".
disable-model-invocation: true
context: fork
agent: Explore
---

# Update Task Details

Analyzes pending tasks against codebase implementation and updates descriptions/priorities to reflect current state.

## Prerequisites

- API server running on port 3001 (or specify port)
- Task API available at `/api/tasks`

## Workflow

### Step 1: Fetch Pending Tasks

Retrieve pending tasks with current details.

```bash
curl -s "http://localhost:3001/api/tasks?status=pending" | jq '.[] | {id, title, description, priority}'
```

**Verification**: Task list with details is returned.

**Error Handling**:
- Connection refused: Ask user for correct port
- Empty response: Report "No pending tasks" and exit

### Step 2: Investigate Implementation Status

For each task, investigate the codebase to determine:

| Aspect | What to Find |
|--------|-------------|
| Implementation Status | Fully implemented / Partial / Not implemented |
| Implemented Parts | List with file paths and line numbers |
| Missing Parts | Specific functionality gaps |
| Related Files | All files related to this task |
| Recommended Priority | high / medium / low based on impact |

**Priority Guidelines**:
- **high**: Blocks other tasks, core functionality, bug fixes
- **medium**: Regular feature additions, improvements
- **low**: Nice-to-have, research tasks, future considerations

**Verification**: Each task has concrete findings with file references.

### Step 3: Report Proposed Changes

Present findings for each task:

```markdown
## Task #ID: Title

**Current Status**: Partial implementation

**Implemented**:
- Feature A (`apps/cli/src/file.ts:100-150`)
- Feature B (`apps/frontend/src/component.tsx:50-80`)

**Not Implemented**:
- Feature C: Needs API endpoint for X
- Feature D: UI control not available

**Proposed Updates**:
- Update description with implementation details
- Change priority: medium → high

---
```

**Verification**: User reviews and approves proposed changes.

### Step 4: Apply Updates

After user confirms with "更新して" or "update":

```bash
curl -s -X PATCH "http://localhost:3001/api/tasks/{id}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "【実装状況】部分的に実装\n\n【実装済み】\n- Feature A (path/to/file.ts)\n\n【未実装】\n- Feature B: 具体的に必要な内容\n\n【関連ファイル】\n- path/to/main.ts",
    "priority": "high"
  }'
```

**Verification**: API returns updated task object.

**Error Handling**:
- 404: Task not found, skip and report
- 400: Invalid data, report validation error

### Step 5: Report Summary

```markdown
## Update Complete

| ID | Task | Changes |
|----|------|---------|
| XX | Task title | description updated, priority: medium → high |
| YY | Task title | description updated |

Total: N tasks updated
```

## Description Format

Use this structured format for updated descriptions:

```
【実装状況】{完全実装 / 部分的に実装 / 未実装}

【実装済み】
- 機能名 (file/path.ts:line)
- 機能名 (file/path.ts:line)

【未実装】
- 機能名: 具体的に何が必要か
- 機能名: 具体的に何が必要か

【関連ファイル】
- path/to/main/file.ts
- path/to/related/file.ts
```

## Important Notes

- **Never update without explicit user confirmation**
- Do not modify task titles unless specifically requested
- Use parallel exploration for efficiency
- Always include file paths as evidence
