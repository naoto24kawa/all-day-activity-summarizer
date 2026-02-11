/**
 * Notion Blocks to Markdown
 *
 * Notion Block オブジェクトを Markdown テキストに変換
 */

interface RichTextItem {
  type: string;
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    underline?: boolean;
  };
  href?: string | null;
}

interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  children?: Block[];
  [key: string]: unknown;
}

interface BlockContent {
  rich_text?: RichTextItem[];
  text?: RichTextItem[];
  caption?: RichTextItem[];
  language?: string;
  checked?: boolean;
  url?: string;
  icon?: { type: string; emoji?: string };
  cells?: RichTextItem[][];
}

/**
 * RichText アノテーションを Markdown に変換
 */
function richTextToMarkdown(richTexts: RichTextItem[]): string {
  return richTexts
    .map((rt) => {
      let text = rt.plain_text;
      const ann = rt.annotations;

      if (ann?.code) {
        text = `\`${text}\``;
      }
      if (ann?.bold) {
        text = `**${text}**`;
      }
      if (ann?.italic) {
        text = `*${text}*`;
      }
      if (ann?.strikethrough) {
        text = `~~${text}~~`;
      }
      if (rt.href) {
        text = `[${text}](${rt.href})`;
      }

      return text;
    })
    .join("");
}

/**
 * 単一ブロックを Markdown に変換
 */
function blockToMarkdown(block: Block, indent = 0): string {
  const prefix = "  ".repeat(indent);
  const content = (block[block.type] as BlockContent) ?? {};
  const richText = content.rich_text ?? content.text ?? [];
  const text = richTextToMarkdown(richText);

  switch (block.type) {
    case "paragraph":
      return text ? `${prefix}${text}` : "";

    case "heading_1":
      return `${prefix}# ${text}`;

    case "heading_2":
      return `${prefix}## ${text}`;

    case "heading_3":
      return `${prefix}### ${text}`;

    case "bulleted_list_item":
      return `${prefix}- ${text}`;

    case "numbered_list_item":
      return `${prefix}1. ${text}`;

    case "to_do":
      return `${prefix}- [${content.checked ? "x" : " "}] ${text}`;

    case "code": {
      const lang = content.language ?? "";
      const caption = content.caption ? richTextToMarkdown(content.caption) : "";
      const code = `${prefix}\`\`\`${lang}\n${prefix}${text}\n${prefix}\`\`\``;
      return caption ? `${code}\n${prefix}${caption}` : code;
    }

    case "quote":
      return text
        .split("\n")
        .map((line) => `${prefix}> ${line}`)
        .join("\n");

    case "callout": {
      const icon = content.icon?.type === "emoji" ? `${content.icon.emoji} ` : "";
      return `${prefix}> ${icon}${text}`;
    }

    case "toggle":
      return `${prefix}<details>\n${prefix}<summary>${text}</summary>\n`;

    case "divider":
      return `${prefix}---`;

    case "image": {
      const imageUrl =
        (block.image as { type: string; file?: { url: string }; external?: { url: string } })?.file
          ?.url ??
        (block.image as { external?: { url: string } })?.external?.url ??
        "";
      const caption = content.caption ? richTextToMarkdown(content.caption) : "";
      return `${prefix}![${caption}](${imageUrl})`;
    }

    case "bookmark": {
      const url = content.url ?? "";
      const caption = content.caption ? richTextToMarkdown(content.caption) : url;
      return `${prefix}[${caption}](${url})`;
    }

    case "embed": {
      const url = content.url ?? "";
      return `${prefix}[${url}](${url})`;
    }

    case "table": {
      // table はヘッダー情報を含むが、実際のデータは table_row children にある
      return "";
    }

    case "table_row": {
      const cells = content.cells ?? [];
      const cellTexts = cells.map((cell) => richTextToMarkdown(cell));
      return `${prefix}| ${cellTexts.join(" | ")} |`;
    }

    default:
      return text ? `${prefix}${text}` : "";
  }
}

/**
 * ブロック配列を Markdown に変換
 */
export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  let inTable = false;
  let tableRowIndex = 0;

  for (const block of blocks) {
    if (block.type === "table") {
      inTable = true;
      tableRowIndex = 0;

      // table の children (table_row) を処理
      if (block.children) {
        for (const row of block.children) {
          const line = blockToMarkdown(row);
          if (line) {
            lines.push(line);
            // ヘッダー行の後にセパレーターを追加
            if (tableRowIndex === 0) {
              const cells = (row[row.type] as BlockContent)?.cells ?? [];
              const separator = `| ${cells.map(() => "---").join(" | ")} |`;
              lines.push(separator);
            }
            tableRowIndex++;
          }
        }
      }
      inTable = false;
      lines.push("");
      continue;
    }

    if (inTable) continue;

    const line = blockToMarkdown(block);
    lines.push(line);

    // children がある場合は再帰的に処理
    if (block.has_children && block.children && block.type !== "table") {
      const childLines = blocksToMarkdown(block.children);
      if (childLines) {
        lines.push(childLines);
      }

      // toggle の閉じタグ
      if (block.type === "toggle") {
        lines.push("</details>");
      }
    }
  }

  return lines.join("\n").trim();
}
