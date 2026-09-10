/**
 * Pull a JSON payload out of a model response, tolerating markdown fences.
 */
export function parseJsonResponse<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim()) as T;
}
