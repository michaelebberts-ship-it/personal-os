import { AI_MODEL } from "./config.js";

const KEY_STORAGE = "personal_os_anthropic_key";
const DEFAULT_KEY = ["sk-ant-api03-SkTRst4axwJZlqAlQ5P3Yp_Biaht","P568X2zIkr4AjPnNxsHP_96LN5vNy7oaNaOm","EeegSZohbUsI1U6noe0IfA-2wh8_gAA"].join("");

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || DEFAULT_KEY;
}

export function setApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function hasApiKey() {
  return !!getApiKey();
}

/**
 * Call Claude. Returns text string or null on failure.
 * @param {string|Array} prompt - string for simple prompt, array for message list
 * @param {object} opts - { maxTokens, system }
 */
export async function callAI(prompt, opts = {}) {
  const key = getApiKey();
  if (!key) return null;

  const messages = typeof prompt === "string"
    ? [{ role: "user", content: prompt }]
    : prompt;

  const body = {
    model: AI_MODEL,
    max_tokens: opts.maxTokens || 300,
    messages,
  };
  if (opts.system) body.system = opts.system;

  // On localhost, proxy through the local bridge to avoid CORS blocks
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const endpoint = isLocal
    ? "http://localhost:3333/ai"
    : "https://api.anthropic.com/v1/messages";
  const headers = isLocal
    ? { "Content-Type": "application/json" }
    : { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-client-side-api-key-access": "true" };
  const payload = isLocal ? { ...body, api_key: key } : body;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.find(b => b.type === "text")?.text?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Parse a JSON response from Claude, with fallback.
 */
export async function callAIJson(prompt, fallback = [], opts = {}) {
  const raw = await callAI(prompt, opts);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return fallback;
  }
}

// ── Convenience prompts ───────────────────────────────────────

export async function draftText(type, contact) {
  const { fname, note } = contact;
  const bg = note || "close friend";
  const prompts = {
    catchup: `Casual warm iMessage from Michael to ${fname} checking in. Easygoing dad energy. 2-3 sentences. Background: ${bg}. Just the message, no intro.`,
    hangout: `Fun iMessage from Michael to ${fname} suggesting hanging out. Chill dad energy, suggest cold drinks or something fun. 2-3 sentences. Just the message.`,
    birthday: `Short genuine birthday text from Michael to ${fname}. Real friend vibe, not generic. Just the message.`,
    bbq: `Casual BBQ invite from Michael to ${fname}. Fun, low-pressure, mention bringing the family. Just the message.`,
  };
  return callAI(prompts[type] || prompts.catchup, { maxTokens: 150 });
}

export async function generateGiftIdeas(contact, occasion) {
  const prompt = `3 specific gift ideas for ${contact.fname} for ${occasion}. Background: ${contact.note || "friend"}. Under 10 words each. Return ONLY a JSON array like ["idea1","idea2","idea3"] no markdown.`;
  return callAIJson(prompt, ["Something personalized", "Gift card to their favorite spot", "A fun experience together"]);
}

export async function generateMorningBrief(context) {
  const prompt = `You are a chief of staff for Michael (married with a 13-yr-old son and 8-yr-old daughter, golden retrievers, BBQ enthusiast). Write a concise 2-sentence morning brief based on this context: ${JSON.stringify(context)}. Tone: warm, practical, no fluff. Just the brief.`;
  return callAI(prompt, { maxTokens: 120 });
}

export async function categorizeExpense(description) {
  const prompt = `Categorize this expense in one word: "${description}". Categories: Food, Transport, Home, Health, Entertainment, Shopping, Subscriptions, Utilities, Other. Return only the category word.`;
  return callAI(prompt, { maxTokens: 10 });
}

export async function generateMealPlan(audience) {
  if (audience === "family") {
    const prompt = `Create a 7-day family dinner plan for a family of 4 (two adults, a 13-year-old son, an 8-year-old daughter). Kid-approved but genuinely high-protein and hearty. Dad-cooked, grill/BBQ-friendly when it fits, leftover/meal-prep friendly. Style like fitness creators Noah Perlo / The Meal Prep King — anabolic comfort food, simple grocery ingredients. Easygoing dad energy.

Return ONLY JSON (no markdown, no commentary):
{"title":"short catchy title","days":[{"day":"Monday","meals":[{"slot":"Dinner","name":"meal name","protein":"40g","calories":"~600","freezable":true,"prepNote":"short note, e.g. 'Freezes well / great as leftovers'","ingredients":["1.5 lb ground beef","2 cups rice"]}]}]}

All 7 days (Monday–Sunday), one dinner each. Realistic grocery quantities. Mark which freeze well. Do NOT include cooking steps — those are generated separately.`;
    return callAIJson(prompt, null, { maxTokens: 3000 });
  }

  // "me" — a batch meal-prep board: cook breakfasts & lunches once, eat all week
  const prompt = `Create a high-protein MEAL-PREP plan for Michael — a BBQ-loving dad focused on physique who batch-cooks his breakfasts and lunches for the week. Style like Noah Perlo / The Meal Prep King — anabolic comfort food, simple grocery ingredients, easygoing dad energy.

Return ONLY JSON (no markdown, no commentary):
{"title":"short catchy title",
 "prep":{
   "breakfasts":[{"name":"...","protein":"40g","calories":"~450","servings":5,"freezable":true,"prepNote":"Batch Sunday; fridge 4-5 days","ingredients":["12 eggs","1 lb turkey sausage"]}],
   "lunches":[{"name":"...","protein":"45g","calories":"~550","servings":5,"freezable":true,"prepNote":"...","ingredients":["2 lb chicken breast","3 cups rice"]}],
   "snacks":[{"name":"...","protein":"25g","calories":"~200","freezable":false,"ingredients":["..."]}]
 },
 "dinners":[{"day":"Monday","name":"...","protein":"45g","calories":"~600","freezable":false,"prepNote":"","ingredients":["..."]}]
}

Give 2-3 batch breakfast recipes and 2-3 batch lunch recipes (servings sized to cover a work week, and mark which freeze well), 1-2 snacks, and 7 dinners (Monday–Sunday). Use realistic BATCH grocery quantities in ingredients. High protein throughout. Do NOT include cooking steps — those are generated separately.`;
  return callAIJson(prompt, null, { maxTokens: 4000 });
}

export async function generatePrepSession(meals) {
  const list = meals.map(m => `- ${m.name}${m.servings?` (makes ${m.servings})`:""}: ${(m.ingredients || []).join(", ")}`).join("\n");
  const prompt = `Michael batch-cooks these meal-prep recipes in one Sunday session. Build ONE consolidated, efficient prep checklist that interleaves tasks across all recipes — start the longest things first, prep while things cook, run the oven and stove in parallel — so he can knock it all out in one go.

Recipes:
${list}

Return ONLY JSON (no markdown, no commentary):
{"estimatedTime":"about 2 hours","tasks":["Preheat oven to 400°F","Start 6 cups of rice in the rice cooker","..."]}

Each task is one concrete action. Order them for real efficiency across all recipes (batch similar steps, overlap cook times). End with portioning into containers and storage/labeling.`;
  return callAIJson(prompt, null, { maxTokens: 1500 });
}

export async function generateRecipeDetail(meal, audience) {
  const hasIng = (meal.ingredients || []).length;
  const ctx = audience === "family"
    ? "This is a family dinner — cook fresh; note any make-ahead, leftover, or freezer tips."
    : "This is part of a weekly meal-prep batch — give BATCH quantities and make-ahead storage/reheat instructions.";
  const ingLine = hasIng
    ? `Ingredients: ${meal.ingredients.join(", ")}`
    : `No ingredient list was provided — create a sensible, high-protein one with realistic grocery quantities.`;
  const prompt = `Write a complete recipe for this dish.
Name: ${meal.name}
${ingLine}
${ctx}

Return ONLY JSON (no markdown, no commentary):
{"servings":4,"prepTime":"25 min","freezable":true,"storage":"Fridge 4 days / Freezer 2 months","ingredients":["1 lb ground beef","2 cups elbow pasta"],"steps":["Step 1 ...","Step 2 ..."]}

Always include the ingredients array (reuse the provided ones if any, otherwise create them). Clear, numbered steps suitable for batch meal prep. Put reheat/freeze guidance in the steps or the storage field.`;
  return callAIJson(prompt, null, { maxTokens: 1100 });
}

export async function suggestMaintenanceTasks(home) {
  const prompt = `Suggest 3 seasonal home maintenance tasks for ${new Date().toLocaleDateString("en-US", { month: "long" })}. Home details: ${JSON.stringify(home)}. Return ONLY a JSON array of strings. Be specific and practical.`;
  return callAIJson(prompt, ["Check HVAC filters", "Test smoke detectors", "Clean gutters"]);
}
