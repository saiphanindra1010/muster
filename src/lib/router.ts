/**
 * Pick a free model for one message. The choice is a keyword match against
 * the models the harness actually listed, so a missing model is skipped and
 * a paid provider is never selected.
 */

export type RoutableModel = { key: string; providerID: string; id: string };

type Lane = "vision" | "code" | "long" | "fast";

const VISION = /\b(screenshot|image|photo|picture|diagram)\b/i;
const CODE = /\b(code|bug|debug|stack ?trace|refactor|function|compile|typescript|javascript|python|rust|sql|pull request|\bpr\b|\bdiff\b|implement|exception|unit test)\b/i;
const LONG = /\b(research|compare|analy[sz]e|plan|architect|explain why|summar)/i;

/** First id that is actually available wins. */
const PREFER: Record<Lane, string[]> = {
  vision: ["opencode/nemotron-3.5-super-vl-free", "opencode/glm-5.3-flash-free"],
  code: ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"],
  long: ["opencode/longcat-2.5-free", "opencode/nemotron-3.5-super-vl-free", "opencode/glm-5.3-flash-free"],
  fast: ["opencode/glm-5.3-flash-free", "opencode/nemotron-3.5-lightning-free", "opencode/deepseek-v4.1-flash-free"],
};

const FALLBACK = "opencode/glm-5.3-flash-free";

function lane(text: string): Lane {
  if (VISION.test(text)) return "vision";
  if (CODE.test(text)) return "code";
  if (text.length > 800 || LONG.test(text)) return "long";
  return "fast";
}

function free(model: RoutableModel): boolean {
  return model.providerID === "opencode" || model.id.endsWith("-free");
}

/** The model for this message, or null when the catalog has no free model. */
export function routeModel(text: string, models: RoutableModel[]): RoutableModel | null {
  const pool = models.filter(free);
  if (!pool.length) return null;
  const byKey = new Map(pool.map((model) => [model.key, model]));
  for (const key of PREFER[lane(text)]) {
    const hit = byKey.get(key);
    if (hit) return hit;
  }
  return byKey.get(FALLBACK) ?? pool[0];
}
