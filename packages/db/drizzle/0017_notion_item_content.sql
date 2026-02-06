-- Notion アイテムに本文カラムを追加
ALTER TABLE notion_items ADD COLUMN content TEXT;
ALTER TABLE notion_items ADD COLUMN content_synced_at TEXT;
