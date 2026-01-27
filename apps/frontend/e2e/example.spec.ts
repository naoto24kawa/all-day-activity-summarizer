import { expect, test } from "@playwright/test";

test("homepage displays correctly with shadcn/ui", async ({ page }) => {
  await page.goto("/");

  // ページタイトルの確認
  await expect(page).toHaveTitle(/Hello World - Hono \+ React/);

  // ヒーローセクションの見出しを確認
  await expect(
    page.getByRole("heading", { name: /モダンフルスタック.*アプリケーション/ }),
  ).toBeVisible();

  // バッジの確認
  await expect(page.getByText("Bun + Hono + React + shadcn/ui")).toBeVisible();

  // ヒーローセクションの説明文の確認
  await expect(page.getByText("Bun Workspacesを使用したモノレポ構成で、")).toBeVisible();

  // ボタンの確認
  await expect(page.getByRole("link", { name: "デモを見る" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub で見る" })).toBeVisible();

  // 機能セクションの確認
  await expect(page.getByRole("heading", { name: "主な機能" })).toBeVisible();

  // デモセクションの確認
  await expect(page.getByRole("heading", { name: "ライブデモ" })).toBeVisible();
  await expect(
    page.getByText("Hono RPC を使った型安全なAPI通信を実際に体験できます"),
  ).toBeVisible();
});
