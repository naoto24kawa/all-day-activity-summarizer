import type { Meta, StoryObj } from "@storybook/react";
import { ApiConfigDemo } from "./api-config-demo";

/**
 * API環境変数デモコンポーネントのストーリー
 *
 * このストーリーは、Hono APIから環境変数を取得して表示する
 * テンプレート実装例を Storybook で表示します。
 *
 * 注意: Storybook環境ではAPIサーバーが起動していないため、
 * 実際の動作確認は開発サーバー（bun run dev）で行ってください。
 */
const meta = {
  title: "App/ApiConfigDemo",
  component: ApiConfigDemo,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ApiConfigDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * デフォルト表示
 *
 * 注意: Storybook環境では/api/configエンドポイントが利用できないため、
 * エラー状態が表示されます。実際の動作は開発サーバーで確認してください。
 */
export const Default: Story = {};
