import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "scripts");

/**
 * packages/core/src/scripts/ 配下の Python スクリプトの絶対パスを返す。
 */
export function getScriptPath(scriptName: string): string {
  return join(SCRIPTS_DIR, scriptName);
}
