/**
 * Daily debrief — the "Ebberts Family Morning Debrief" AI brief.
 * Shared by Home and the Kitchen kiosk; cached once per day in localStorage.
 */

import { getApiKey, callAI, callAIJson } from "./ai.js";
import { fetchWeather } from "./weather.js";

const tod = () => new Date().toISOString().slice(0, 10);
const fmt12 = t => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

// ── Kitchen day-brief: short, witty "headline + 3 hits", shifts by time of day ──
export function dayBriefCacheKey(period) { return `kbrief_${tod()}_${period}`; }

export async function getDayBrief(period, { events = [], dinner = null, weatherStr = "unknown", tomorrow = null } = {}) {
  if (!getApiKey()) return null;   // caller renders a non-AI fallback
  const cached = localStorage.getItem(dayBriefCacheKey(period));
  if (cached) { try { return JSON.parse(cached); } catch {} }

  const periodWord = {
    morning: "morning — look ahead at the whole day",
    midday:  "midday — a quick check-in on what's left today",
    evening: "evening — wind-down; how the day went plus a peek at tomorrow",
  }[period] || "today";
  const evList = events.length
    ? events.map(e => `${e.time ? fmt12(e.time) : "all day"} ${e.title}`).join("; ")
    : "nothing scheduled";

  const prompt = `Write a tiny ${periodWord} blurb for the Ebberts family KITCHEN dashboard. Voice: easygoing dad — warm, a little funny, never corny.
Today's events: ${evList}
Weather: ${weatherStr}
Tonight's dinner: ${dinner || "TBD"}
${period === "evening" && tomorrow ? `Tomorrow: ${tomorrow}` : ""}

Give a punchy HEADLINE (≤5 words, witty, captures the day's vibe) and EXACTLY 3 quick hits (each ≤8 words). The hits must SYNTHESIZE — e.g. the busiest stretch, the one thing not to forget, a weather heads-up; for evening: how it went + tomorrow + dinner. Do NOT just relist the schedule. An emoji here or there is fine.
Return ONLY JSON: {"headline":"...","hits":["...","...","..."]}`;

  const result = await callAIJson(prompt, null, { maxTokens: 250 });
  if (result && result.headline && Array.isArray(result.hits)) {
    localStorage.setItem(dayBriefCacheKey(period), JSON.stringify(result));
    return result;
  }
  return null;
}

export function debriefCacheKey() { return `debrief_${tod()}`; }
export function getCachedDebrief() { return localStorage.getItem(debriefCacheKey()); }

/**
 * Returns { text, error } where error is null | "no_key" | "api_failed".
 * Uses the per-day cache; generates + caches on a miss. Does not touch the DOM.
 */
export async function getDebrief(todayEvents, reminders) {
  if (!getApiKey()) return { text: null, error: "no_key" };

  const cached = getCachedDebrief();
  if (cached) return { text: cached, error: null };

  const weather = await fetchWeather();
  const eventList = (todayEvents || []).map(e =>
    `${e.time ? fmt12(e.time) : "All day"}: ${e.title}${e.location ? " @ " + e.location : ""}`);
  const reminderList = (reminders || []).filter(r => !r.completed && r.dueDate <= tod()).map(r => r.title);

  const prompt = `You are COMMAND CENTRAL — the Ebberts Family Executive Assistant. Every morning you deliver the daily briefing to the Ebberts family: sharp, warm, and organized so everyone knows exactly what the day holds.
You have been given today's calendar events, reminders, and weather. Using that data, write the ☀️ Ebberts Family Morning Debrief in this format:
☀️ TEAM EBBY MORNING DEBRIEF [Day, Date] — Good morning, Ebberts crew!
📅 TODAY'S MISSIONS List each event with time, who it's for, and any prep note if relevant (e.g. "leave by 7:45")
✅ ON THE RADAR Reminders and tasks due today — keep it punchy, one line each
🌤 WEATHER HEADS UP One sentence. Only flag it if it affects the day (rain, extreme temp, storms)
💬 COMMAND CENTRAL SAYS One motivating or funny closer. Reference something specific from the day's schedule to make it feel personal — not generic. Keep it under 2 sentences.
Rules: Keep the whole message under 220 words. Write like a trusted family assistant who knows them well — warm but efficient. No filler phrases like "Here is your briefing." Just start with the header. Use the calendar, reminders, and weather data provided. If nothing is on the calendar, say so with some humor.

TODAY'S DATA:
Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
Events: ${eventList.length ? eventList.join("\n") : "None"}
Reminders due: ${reminderList.length ? reminderList.join(", ") : "None"}
Weather: ${weather || "Unknown"}`;

  try {
    const text = await callAI(prompt, { maxTokens: 400 });
    if (text) {
      localStorage.setItem(debriefCacheKey(), text);
      return { text, error: null };
    }
    return { text: null, error: "api_failed" };
  } catch {
    return { text: null, error: "api_failed" };
  }
}
