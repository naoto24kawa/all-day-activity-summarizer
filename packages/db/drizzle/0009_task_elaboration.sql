-- Task Elaboration: 親子タスク + 非同期詳細化
ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN elaboration_status TEXT;
ALTER TABLE tasks ADD COLUMN pending_elaboration TEXT;
ALTER TABLE tasks ADD COLUMN step_number INTEGER;

CREATE INDEX idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX idx_tasks_elaboration_status ON tasks(elaboration_status);
