import { resolve, join } from "path";

/**
 * Persistent application data lives here. Railway should mount its volume at
 * /data and set DATA_DIR=/data. Local development keeps the existing folders
 * in the project root when DATA_DIR is not configured.
 */
export function dataPath(...parts: string[]): string {
  const root = process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR)
    : process.cwd();
  return join(root, ...parts);
}
