/**
 * Transformation Protocol Module
 * Dad Bod → Year 40 fitness dashboard, recolored for the Command Center.
 * Data stored in localStorage under 'transformation_*' keys.
 */

let _container = null;
let _ctx = null;
let _interval = null;
let _styleEl = null;
let _oura = null;       // cached Oura payload
let _ouraSection = null; // null | 'sleep' | 'readiness' | 'activity'
let _workoutsExpanded = false;
let _shortcutWorkouts = []; // Apple Health workouts via iOS Shortcut → iCloud Drive
let _ouraInsight = { text: null, loading: false, error: null };
let _health = null;     // Apple Health payload
let _renpho = null;    // Full RENPHO body-comp payload
const _insights = {
  health: { text: null, loading: false, error: null },
  weight: { text: null, loading: false, error: null },
  protein: { text: null, loading: false, error: null },
  pullup:  { text: null, loading: false, error: null },
  recovery:{ text: null, loading: false, error: null },
  workout: { text: null, loading: false, error: null },
  checklist:{ text: null, loading: false, error: null },
};

// ── Gold accent (transformation identity color) ───────────────
const GOLD = '#C9A961';
const GOLD_DIM = 'rgba(201,169,97,0.12)';
const GOLD_BORDER = 'rgba(201,169,97,0.25)';

// ── Program dates (midnight Central — Sep 9 is CDT = UTC-5) ─────
const TARGET_DATE   = new Date('2026-09-09T00:00:00-05:00'); // Day One starts
const PROGRAM_DAYS  = 40;
const PROGRAM_END   = new Date(TARGET_DATE.getTime() + PROGRAM_DAYS * 86400000);

// Returns { phase, daysLeft, dayNum, subtitle }
function getPhase(now) {
  const msToStart = TARGET_DATE - now;
  if (msToStart > 0) {
    // Pre-program: counting down to Day One
    const daysLeft = Math.max(0, Math.ceil(msToStart / 86400000));
    return { phase: 'pre', daysLeft, dayNum: 0, subtitle: 'SEPTEMBER 9 — DAY ONE OF 40' };
  }
  const dayNum = Math.min(PROGRAM_DAYS, Math.floor((now - TARGET_DATE) / 86400000) + 1);
  if (dayNum <= PROGRAM_DAYS) {
    // In-program
    const daysLeft = PROGRAM_DAYS - dayNum + 1;
    return { phase: 'active', daysLeft, dayNum, subtitle: `DAY ${dayNum} OF ${PROGRAM_DAYS}` };
  }
  return { phase: 'done', daysLeft: 0, dayNum: PROGRAM_DAYS, subtitle: 'TRANSFORMATION COMPLETE 🏆' };
}

// ── Data ──────────────────────────────────────────────────────
const WORKOUTS = {
  0: {
    name: 'REST DAY', sub: 'Active Recovery', recovery: 'rest', recoveryLabel: '😴 Rest',
    warmup: 'None required — keep movement gentle.',
    blocks: [
      { title: 'WALK', time: '20-30 min', moves: [{ name: 'Outdoor walk', detail: 'Brisk but conversational pace. Get sunlight on your face. Aim for 3,000+ steps here.' }] },
      { title: 'MOBILITY FLOW', time: '10 min', moves: [
        { name: "World's greatest stretch", detail: '5 per side. Open the hips and thoracic spine.' },
        { name: 'Cat-cow', detail: '10 reps slow. Mobilize the spine.' },
        { name: 'Deep squat hold', detail: '60 sec. Heels down, chest up, breathe.' },
        { name: '90/90 hip switches', detail: '10 per side. Hip rotation.' }
      ]},
      { title: 'OPTIONAL', time: '15-20 min', moves: [{ name: 'Sauna OR contrast therapy', detail: 'Sauna 15-20 min, OR contrast: sauna 15 → ice 2 → sauna 10 → ice 1. End on cold.' }] }
    ],
    note: "Recovery IS the program. Don't skip this day to do 'just one more workout.' This is when adaptation happens."
  },
  1: {
    name: 'KB STRENGTH A', sub: 'Lower Body / Posterior Chain', recovery: 'sauna', recoveryLabel: '🔥 Sauna',
    warmup: '2 min: 20 bodyweight squats → 10 hip hinges → 10 KB halos → 5 inchworms',
    blocks: [{ title: 'MAIN WORK — EMOM × 16 MIN (4 ROUNDS)', time: '16 min', moves: [
      { name: 'Min 1 — KB Goblet Squat × 10', detail: 'Hold KB at chest, elbows tucked. Sit BETWEEN your heels, knees track over toes. Drive floor away. Pause 1 sec at bottom.' },
      { name: 'Min 2 — KB Romanian Deadlift × 10', detail: 'KB in both hands. Hinge at hips, push butt back, slight knee bend. KB grazes thighs to mid-shin. Squeeze glutes to stand.' },
      { name: 'Min 3 — KB Swings × 8 (heavy/explosive)', detail: "Hike KB back between legs, snap hips forward HARD. KB floats to chest height — don't lift it with arms. Glutes do the work." },
      { name: 'Min 4 — Plank × 30 sec', detail: "Forearms down, body straight, glutes squeezed, brace abs like taking a punch. Don't let hips sag." }
    ]}],
    cooldown: "2 min: pigeon stretch 30 sec/side, child's pose 30 sec, deep breathing 30 sec.",
    scaling: "Too easy: go heavier on swings, hold goblet at chin level. Too hard: cut to 8 squats, 8 RDLs, 6 swings.",
    note: 'Focus today: hip drive and posterior chain. Your butt and hamstrings should be lit up.'
  },
  2: {
    name: 'BODYWEIGHT CONDITIONING', sub: 'Full-Body AMRAP', recovery: 'ice', recoveryLabel: '🧊 Ice Bath',
    warmup: '2 min: 20 jumping jacks → 10 squats → 10 push-ups (knees ok) → 10 mountain climbers',
    blocks: [{ title: '16-MIN AMRAP', time: '16 min', moves: [
      { name: '10 Push-Ups', detail: 'Hands under shoulders, body in straight line, chest to fist-height from floor. Scale to incline (hands on bench) if form breaks.' },
      { name: '15 Air Squats', detail: 'Feet shoulder-width, toes slightly out. Sit back and down, hips below knees if mobility allows.' },
      { name: '20 Mountain Climbers', detail: "Plank position. Drive knee to chest, alternate. Hips stay LOW — don't let butt rise. Count = total reps." },
      { name: '10 Reverse Lunges (5 per leg)', detail: 'Step BACK, drop back knee toward floor. Front knee stays over front foot, torso upright.' }
    ]}],
    cooldown: '2 min: standing forward fold, quad stretch each leg, deep breathing.',
    scaling: 'Goal: 5-7 rounds. If fewer than 4, scale push-ups to knees. If 8+, slow down — form is sloppy.',
    note: 'Score your total rounds + extra reps. Write it down. Next time, beat it.'
  },
  3: {
    name: 'PULL-UP FOCUS', sub: 'The Bar Day', recovery: 'sauna', recoveryLabel: '🔥 Sauna',
    warmup: '2 min: 10 arm circles each direction → 10 band pull-aparts → 5 scap pulls on bar → shoulder rolls.',
    blocks: [
      { title: '4 ROUNDS, 60-90 SEC REST', time: '14-16 min', moves: [
        { name: '① Dead Hang — MAX EFFORT', detail: "Grip the bar shoulder-width, palms forward. Engage shoulders DOWN — don't dangle. Note your time each round. Goal: 60 sec." },
        { name: '② Scapular Pull-Ups × 8', detail: 'Hang from bar, arms straight. WITHOUT bending elbows, pull shoulder blades DOWN — body rises 1-2 inches. Hold 1 sec. Lower with control.' },
        { name: '③ Negative Pull-Up × 3 (5-sec descent)', detail: 'Jump so chin is over the bar. Lower slowly — count 5 full seconds. The slower, the better.' },
        { name: '④ Inverted Rows × 10', detail: 'Set bar at hip height. Pull chest to bar, squeeze shoulder blades. Lower slowly.' }
      ]},
      { title: 'FINISHER', time: '2 min', moves: [
        { name: 'Hollow Body Hold × 3 × 20 sec', detail: 'Lie on back, lower back PRESSED into floor, legs 6 inches off floor, arms overhead. Banana shape.' }
      ]}
    ],
    cooldown: '2 min: doorway chest stretch, cross-body shoulder stretch, neck rolls.',
    note: 'Track your dead hang time — when you hit 60 sec, you\'re 4-6 weeks from your first pull-up.'
  },
  4: {
    name: 'KB STRENGTH B', sub: 'Upper Body / Push-Pull', recovery: 'sauna', recoveryLabel: '🔥 Sauna',
    warmup: '2 min: arm circles → 10 KB halos each direction → 10 push-ups → 10 band pull-aparts.',
    blocks: [{ title: '4 ROUNDS, 40 SEC WORK / 20 SEC REST', time: '16 min', moves: [
      { name: 'KB Clean & Press — Right Arm', detail: 'Clean: swing KB up and tuck to shoulder. Press: drive KB overhead, bicep by ear at top. Lower under control.' },
      { name: 'KB Clean & Press — Left Arm', detail: "Same as right. Match the rep count. Don't arch your lower back — squeeze glutes and abs." },
      { name: 'KB Bent-Over Row — Right Arm', detail: 'Hinge at hips, flat back. Pull KB to ribs — elbow drives BACK. Squeeze shoulder blade. Lower slowly.' },
      { name: 'KB Bent-Over Row — Left Arm', detail: "Same as right. Match reps. Keep core braced — don't let your lower back round." }
    ]}],
    cooldown: "2 min: doorway pec stretch, child's pose with arm reach, deep breathing.",
    note: 'Today builds shoulders, back, and arms — the visible muscles that make the September 9 transformation pop.'
  },
  5: {
    name: 'MIXED POWER CIRCUIT', sub: 'Full-Body Conditioning', recovery: 'ice', recoveryLabel: '🧊 Ice Bath',
    warmup: '2 min: 10 squats → 10 hip hinges → 10 push-ups → 10 KB halos → 5 scap pulls.',
    blocks: [{ title: '5 ROUNDS, 45 SEC WORK / 15 SEC REST', time: '20 min', moves: [
      { name: '① KB Swings', detail: 'Two-hand swing. Hinge, snap hips, KB floats to chest. Power from glutes, not arms.' },
      { name: '② Push-Ups', detail: 'Standard form. Drop to knees mid-set if form breaks. 10-20 reps in 45 sec.' },
      { name: '③ KB Goblet Squats', detail: 'KB at chest. Sit deep, drive up. Controlled tempo — 2 sec down, 1 sec up.' },
      { name: '④ Inverted Rows OR Scap Pulls', detail: 'Use inverted rows if bar is set up. Otherwise 10 scap pulls. Squeeze.' },
      { name: '⑤ Plank Hold', detail: 'Hold the full 45 sec. Brace abs, squeeze glutes, breathe steady.' }
    ]}],
    note: "This is your 'everything day.' Cardio, strength, and core in one shot. You should be sweating buckets by round 3."
  },
  6: {
    name: 'CONDITIONING FINISHER', sub: 'Short + Brutal', recovery: 'ice', recoveryLabel: '🧊 Ice Bath',
    warmup: '3 min: 20 jumping jacks → 10 squats → 10 push-ups → 10 KB swings (light) → 5 burpees slow.',
    blocks: [
      { title: '10-MIN EMOM', time: '10 min', moves: [
        { name: 'ODD MINUTES — KB Swings × 12', detail: 'Two-hand swings. Aggressive hip snap. Finish in 25-30 sec. Rest the remainder.' },
        { name: 'EVEN MINUTES — Burpees × 10', detail: "Drop to plank → push-up → jump feet in → jump up. Don't collapse — control the descent." }
      ]},
      { title: 'MOBILITY FLOW', time: '6 min', moves: [
        { name: "World's greatest stretch", detail: '5 per side.' },
        { name: 'Pigeon pose', detail: '60 sec per side.' },
        { name: "Child's pose with reach", detail: '60 sec.' },
        { name: '90/90 hip switches', detail: '10 per side.' },
        { name: 'Deep breathing', detail: '10 slow breaths. 4 in, 6 out.' }
      ]}
    ],
    note: "By minute 6, you'll want to quit. Don't. Finish strong, hit the ice bath, own the weekend."
  }
};

const DAILY_CHECKLIST = [
  { id: 'water',      text: 'Water + salt (16 oz)',      time: '5:00 AM' },
  { id: 'levo',       text: 'Levothyroxine',             time: '5:05 AM' },
  { id: 'amino',      text: 'Perfect Amino (10g)',        time: '5:10 AM' },
  { id: 'train',      text: 'Train (20 min)',             time: '5:45 AM' },
  { id: 'recovery',   text: 'Sauna OR Ice bath',          time: '6:05 AM' },
  { id: 'sunlight',   text: 'Sunlight 5-10 min',          time: '6:30 AM' },
  { id: 'breakfast',  text: 'Breakfast + DAKE + coffee',  time: '7:00 AM' },
  { id: 'protein',    text: 'Hit 150-180g protein',       time: 'All day' },
  { id: 'steps',      text: '7,000+ steps',              time: 'All day' },
  { id: 'water-total',text: '100+ oz water',             time: 'All day' },
  { id: 'dinner',     text: 'Dinner by 6:30 PM',         time: '6:30 PM' },
  { id: 'sleep',      text: 'In bed by 9:30 PM',         time: '9:30 PM' },
];

const DAY_LETTERS = ['S','M','T','W','T','F','S'];

const TABS = {
  today:       { label: 'Morning',    title: 'Morning Sequence', items: ['<strong>5:00 AM</strong> — Wake, 16 oz water + pinch of salt','<strong>5:05 AM</strong> — Levothyroxine (water only)','<strong>5:10 AM</strong> — Perfect Amino (10g) — protects muscle','<strong>5:30 AM</strong> — Warm-up + mobility','<strong>5:45 AM</strong> — TRAIN (20 min)','<strong>6:05 AM</strong> — Sauna (strength) or Ice bath (cond.)','<strong>6:30 AM</strong> — Sunlight 5-10 min outside','<strong>7:00 AM</strong> — Breakfast + DAKE (with fat) + coffee + protein shake'] },
  nutrition:   { label: 'Nutrition',  title: 'Daily Targets', items: ['<strong>Calories:</strong> 1,600-1,800','<strong>Protein:</strong> 150-180g (non-negotiable)','<strong>Carbs:</strong> 50-100g (mostly veggies + berries)','<strong>Fat:</strong> 60-75g','<strong>Water:</strong> 100+ oz','<strong>Build meals around:</strong> chicken, salmon, lean beef, eggs, broccoli, spinach, avocado','<strong>Hunger killers:</strong> Greek yogurt, eggs, cottage cheese, whey, sparkling water','<strong>Avoid:</strong> sugar, bread, pasta, alcohol (zero — MASH)'] },
  recovery:    { label: 'Recovery',   title: 'Sauna & Ice Bath Protocol', items: ['<strong>Mon/Wed/Thu (strength):</strong> 🔥 Sauna 15-20 min @ 170-190°F','<strong>Tue/Fri/Sat (conditioning):</strong> 🧊 Ice bath 2-5 min @ 45-55°F','<strong>Sun:</strong> Optional sauna OR contrast (sauna 15 → ice 2 → repeat)','<strong>Never:</strong> Ice bath within 4 hrs of strength training','<strong>Hydrate:</strong> 16-20 oz water + salt before sauna','<strong>Electrolytes:</strong> after every sauna (Zepbound depletes them)','<strong>Cold breathing:</strong> 4 sec in, 6-8 sec out','<strong>Rewarm naturally</strong> after ice — no hot shower for 20-30 min'] },
  supplements: { label: 'Stack',      title: 'Supplement Stack', items: ['<strong>5:05 AM:</strong> Levothyroxine + water only','<strong>5:10 AM:</strong> Perfect Amino (10g) pre-workout','<strong>Post-workout:</strong> Perfect Amino (5g) if protein behind','<strong>7:00 AM:</strong> DAKE with breakfast (must have fat)','<strong>Rules:</strong> DAKE empty stomach = wasted dose','<strong>Levo buffer:</strong> 60 min before food/DAKE','<strong>Bloodwork every 3 months:</strong> liver, full thyroid, lipids, vitamin D','<strong>Adjust if vitamin D rises above 80 ng/mL</strong>'] },
  rules:       { label: 'Rules',      title: 'Non-Negotiables', items: ['Levothyroxine first. 60-min buffer before food/DAKE.','Protein at every meal. Hit 150-180g daily.','Zero alcohol. MASH closes that door.','Sleep by 9:30 PM. 8 hrs minimum.','Sunlight in eyes within 30 min of waking.','Caffeine off by 1:00 PM.','Walk 7,000+ steps daily.','Weigh in once a week — same day, same time.','Bloodwork every 3 months: liver, full thyroid, lipids.','Deload week 7 and week 14.',"Show up on the days you don't feel like it."] },
};

// ── Meal shortcuts ─────────────────────────────────────────────
const MEAL_SHORTCUTS = [
  { label: 'Shake',   g: 45 },
  { label: 'Chicken', g: 35 },
  { label: 'Beef',    g: 40 },
  { label: 'Eggs ×3', g: 18 },
  { label: 'Yogurt',  g: 20 },
];

// Set to true the moment the user makes any local change — blocks Firestore overwrite
let _localDirty = false;

// ── State ──────────────────────────────────────────────────────
const S = {
  weight: 200, checks: {}, protein: 0,
  pullup: { hang: 15, neg: 3, rows: 8 },
  weekDone: {}, activeTab: 'today',
  workoutExpanded: true, activeChart: 'weight', chartRange: '3M',
  recovery: { sauna: 0, ice: 0 }, // weekly minutes
};
const START_WEIGHT = 200, GOAL_WEIGHT = 170, PROTEIN_TARGET = 165;

const todayKey = () => new Date().toISOString().slice(0, 10);
const weekKey = () => { const d = new Date(), s = new Date(d); s.setDate(d.getDate() - d.getDay()); return s.toISOString().slice(0, 10); };

// ── Storage ────────────────────────────────────────────────────
const TXM_FS_URL = `https://firestore.googleapis.com/v1/projects/inner-circle-crm/databases/(default)/documents/users/owner-inner-circle-crm/sync/transformation?key=AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4`;

function txSave() {
  try {
    localStorage.setItem('transformation_weight', S.weight);
    localStorage.setItem('transformation_pullup', JSON.stringify(S.pullup));
    localStorage.setItem('transformation_checks_' + todayKey(), JSON.stringify(S.checks));
    localStorage.setItem('transformation_protein_' + todayKey(), S.protein);
    localStorage.setItem('transformation_week_' + weekKey(), JSON.stringify(S.weekDone));
    const wH = JSON.parse(localStorage.getItem('transformation_weight_history') || '{}');
    wH[todayKey()] = S.weight;
    localStorage.setItem('transformation_weight_history', JSON.stringify(wH));
    const pH = JSON.parse(localStorage.getItem('transformation_pullup_history') || '{}');
    pH[todayKey()] = { ...S.pullup };
    localStorage.setItem('transformation_pullup_history', JSON.stringify(pH));
    localStorage.setItem('transformation_recovery_' + weekKey(), JSON.stringify(S.recovery));
  } catch (e) { console.error('Save error:', e); }
  // Mirror to Firestore for cross-device sync
  txPushFirestore();
}

function txPushFirestore() {
  const wH = JSON.parse(localStorage.getItem('transformation_weight_history') || '{}');
  const pH = JSON.parse(localStorage.getItem('transformation_pullup_history') || '{}');
  const payload = {
    weight:        { doubleValue: S.weight },
    protein:       { integerValue: String(S.protein) },
    pullup:        { stringValue: JSON.stringify(S.pullup) },
    checks:        { stringValue: JSON.stringify(S.checks) },
    weekDone:      { stringValue: JSON.stringify(S.weekDone) },
    recovery:      { stringValue: JSON.stringify(S.recovery) },
    weightHistory: { stringValue: JSON.stringify(wH) },
    pullupHistory: { stringValue: JSON.stringify(pH) },
    dateKey:       { stringValue: todayKey() },
    weekKey_:      { stringValue: weekKey() },
    lastSync:      { timestampValue: new Date().toISOString() },
  };
  fetch(TXM_FS_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: payload }),
  }).catch(() => {}); // silent fail — localStorage is the source of truth
}

async function txLoadFirestore() {
  try {
    const res = await fetch(TXM_FS_URL);
    if (!res.ok) return false;
    const doc = await res.json();
    const f = doc.fields;
    if (!f) return false;
    const fsDateKey = f.dateKey?.stringValue;
    const fsWeekKey = f.weekKey_?.stringValue;
    // Only load if Firestore has today's / this week's data
    if (fsDateKey === todayKey()) {
      if (f.weight?.doubleValue)   S.weight  = f.weight.doubleValue;
      // Only override user-mutated fields if the user hasn't made changes this session
      if (!_localDirty) {
        if (f.protein?.integerValue) S.protein = parseInt(f.protein.integerValue);
        if (f.checks?.stringValue)   S.checks  = JSON.parse(f.checks.stringValue);
      }
      if (f.pullup?.stringValue)   S.pullup  = JSON.parse(f.pullup.stringValue);
    }
    if (fsWeekKey === weekKey()) {
      if (f.weekDone?.stringValue)  S.weekDone = JSON.parse(f.weekDone.stringValue);
      if (f.recovery?.stringValue)  S.recovery = JSON.parse(f.recovery.stringValue);
    }
    if (f.weightHistory?.stringValue) {
      // Merge: local entries win (may already have RENPHO's full history)
      const fsWH    = JSON.parse(f.weightHistory.stringValue || '{}');
      const localWH = JSON.parse(localStorage.getItem('transformation_weight_history') || '{}');
      localStorage.setItem('transformation_weight_history', JSON.stringify({ ...fsWH, ...localWH }));
    }
    if (f.pullupHistory?.stringValue) localStorage.setItem('transformation_pullup_history', f.pullupHistory.stringValue);
    return true;
  } catch { return false; }
}

function txLoad() {
  try {
    const w = localStorage.getItem('transformation_weight'); if (w) S.weight = parseFloat(w);
    const p = localStorage.getItem('transformation_pullup'); if (p) S.pullup = JSON.parse(p);
    const c = localStorage.getItem('transformation_checks_' + todayKey()); if (c) S.checks = JSON.parse(c);
    const pr = localStorage.getItem('transformation_protein_' + todayKey()); if (pr) S.protein = parseInt(pr);
    const wd = localStorage.getItem('transformation_week_' + weekKey()); if (wd) S.weekDone = JSON.parse(wd);
    const rec = localStorage.getItem('transformation_recovery_' + weekKey()); if (rec) S.recovery = JSON.parse(rec);
  } catch (e) { console.error('Load error:', e); }
}

function getWeightHistory() { try { return JSON.parse(localStorage.getItem('transformation_weight_history') || '{}'); } catch { return {}; } }
function getPullupHistory() { try { return JSON.parse(localStorage.getItem('transformation_pullup_history') || '{}'); } catch { return {}; } }
function getBfHistory()     { try { return JSON.parse(localStorage.getItem('transformation_bf_history')     || '{}'); } catch { return {}; } }
function getVfHistory()     { try { return JSON.parse(localStorage.getItem('transformation_vf_history')     || '{}'); } catch { return {}; } }

function filterByRange(history) {
  const days = { '3M': 90, '6M': 180, '1Y': 365, '2Y': 730 }[S.chartRange];
  if (!days) return history; // 'All'
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return history.filter(d => d.date >= cutoffStr);
}

// ── Module-scoped styles ───────────────────────────────────────
function injectStyles() {
  if (document.getElementById('txm-styles')) return;
  const el = document.createElement('style');
  el.id = 'txm-styles';
  el.textContent = `
    .txm { font-family: var(--font-sans); color: var(--text-primary); }
    .txm-header {
      background: var(--bg-elevated);
      border: 1px solid ${GOLD_BORDER};
      border-radius: var(--radius-lg);
      padding: 24px 28px;
      margin-bottom: 16px;
      text-align: center;
    }
    .txm-tagline { color: ${GOLD}; font-size: 11px; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 6px; font-weight: 700; }
    .txm-title { font-family: var(--font-sans); font-size: 22px; font-weight: 800; letter-spacing: 0.5px; color: var(--text-primary); }
    .txm-countdown { display: flex; justify-content: center; gap: 48px; margin-top: 16px; flex-wrap: wrap; }
    .txm-cd-item { text-align: center; }
    .txm-cd-num { font-size: 38px; font-weight: 800; color: ${GOLD}; line-height: 1; font-variant-numeric: tabular-nums; font-family: var(--font-sans); }
    .txm-cd-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-secondary); margin-top: 6px; }
    .txm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin-bottom: 14px; }
    .txm-card { background: var(--bg-surface); border: 1px solid var(--separator); border-radius: var(--radius-lg); padding: 18px 20px; }
    .txm-card h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-secondary); margin-bottom: 14px; font-weight: 700; display: flex; align-items: center; justify-content: space-between; }
    .txm-badge { background: ${GOLD}; color: #000; padding: 2px 9px; border-radius: 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }
    .txm-workout-card { background: var(--bg-elevated); border-color: ${GOLD_BORDER}; grid-column: 1 / -1; }
    .txm-workout-card h2 { color: ${GOLD}; }
    .txm-workout-name { font-family: var(--font-sans); font-size: 20px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px; }
    .txm-workout-sub { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; }
    .txm-warmup { background: ${GOLD_DIM}; border-left: 3px solid ${GOLD}; padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
    .txm-warmup-label { color: ${GOLD}; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-right: 6px; }
    .txm-cooldown { background: rgba(0,212,255,0.06); border-left: 3px solid var(--accent); padding: 10px 12px; border-radius: 6px; margin-top: 14px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
    .txm-section-title { color: ${GOLD}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
    .txm-section-time { color: var(--text-tertiary); font-size: 10px; }
    .txm-move { background: var(--bg-surface-2); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; }
    .txm-move:last-child { margin-bottom: 0; }
    .txm-move-name { font-weight: 700; color: var(--text-primary); margin-bottom: 4px; font-size: 13px; }
    .txm-move-detail { color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
    .txm-meta { background: var(--bg-surface-2); border-radius: 8px; padding: 10px 12px; margin-top: 10px; font-size: 11px; line-height: 1.5; color: var(--text-secondary); }
    .txm-meta strong { color: ${GOLD}; text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; }
    .txm-expand-btn { background: ${GOLD_DIM}; color: ${GOLD}; border: 1px solid ${GOLD_BORDER}; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 10px; text-transform: uppercase; letter-spacing: 1px; font-family: inherit; }
    .txm-expand-btn:hover { background: rgba(201,169,97,0.2); }
    .txm-weight-display { text-align: center; padding: 10px 0; }
    .txm-weight-num { font-family: var(--font-sans); font-size: 46px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; color: var(--text-primary); }
    .txm-weight-unit { font-size: 16px; color: var(--text-secondary); margin-left: 4px; }
    .txm-progress-bar { height: 10px; background: var(--bg-surface-2); border-radius: 5px; overflow: hidden; margin: 10px 0 6px; }
    .txm-progress-fill { height: 100%; background: linear-gradient(90deg, ${GOLD} 0%, #E8C878 100%); border-radius: 5px; transition: width 0.4s ease; }
    .txm-progress-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); }
    .txm-input-row { display: flex; gap: 8px; margin-top: 12px; }
    .txm-input { flex: 1; padding: 9px 12px; background: var(--bg-surface-2); border: 1px solid var(--separator); border-radius: 8px; font-size: 14px; font-family: inherit; color: var(--text-primary); }
    .txm-input:focus { outline: none; border-color: ${GOLD}; }
    .txm-btn { background: var(--bg-surface-2); color: var(--text-primary); border: 1px solid var(--separator); padding: 9px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; font-family: inherit; }
    .txm-btn:hover { background: var(--bg-surface-3); }
    .txm-btn-gold { background: ${GOLD}; color: #000; border-color: ${GOLD}; }
    .txm-btn-gold:hover { background: #B89548; border-color: #B89548; }
    .txm-btn-sm { padding: 5px 9px; font-size: 11px; }
    .txm-checklist { list-style: none; }
    .txm-checklist li { display: flex; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--separator); cursor: pointer; user-select: none; }
    .txm-checklist li:last-child { border-bottom: none; }
    .txm-checkbox { width: 20px; height: 20px; border: 2px solid var(--separator-strong); border-radius: 6px; margin-right: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; }
    .txm-checklist li.done .txm-checkbox { background: ${GOLD}; border-color: ${GOLD}; }
    .txm-checklist li.done .txm-checkbox::after { content: '✓'; color: #000; font-weight: 800; font-size: 13px; }
    .txm-check-text { font-size: 13px; line-height: 1.4; flex: 1; color: var(--text-primary); }
    .txm-checklist li.done .txm-check-text { text-decoration: line-through; color: var(--text-tertiary); }
    .txm-check-time { font-size: 11px; color: var(--text-tertiary); margin-left: 8px; font-variant-numeric: tabular-nums; }
    .txm-macro-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .txm-macro-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .txm-macro-value { font-family: var(--font-sans); font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .txm-macro-bar { height: 8px; background: var(--bg-surface-2); border-radius: 4px; overflow: hidden; margin-bottom: 12px; }
    .txm-macro-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
    .txm-protein-btns { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .txm-week-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-top: 8px; }
    .txm-day-box { height: 52px; border: 1px solid var(--separator); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 11px; cursor: pointer; transition: all 0.15s; }
    .txm-day-box:hover { border-color: ${GOLD}; }
    .txm-day-box.today { border-color: ${GOLD}; border-width: 2px; }
    .txm-day-box.done { background: ${GOLD}; color: #000; border-color: ${GOLD}; }
    .txm-day-letter { font-weight: 700; font-size: 10px; text-transform: uppercase; color: inherit; }
    .txm-day-num { font-size: 16px; font-weight: 800; margin-top: 2px; color: inherit; }
    .txm-pull-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
    .txm-recovery-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 8px; }
    .txm-stat-box { background: var(--bg-surface-2); padding: 12px 8px; border-radius: 10px; text-align: center; }
    .txm-stat-num { font-family: var(--font-sans); font-size: 24px; font-weight: 800; color: ${GOLD}; line-height: 1; font-variant-numeric: tabular-nums; }
    .txm-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-top: 4px; }
    .txm-stat-btns { display: flex; gap: 4px; justify-content: center; margin-top: 8px; }
    .txm-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 12px; text-align: center; line-height: 1.4; }
    .txm-chart-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--separator); flex-wrap: wrap; }
    .txm-chart-tab { padding: 8px 14px; cursor: pointer; font-size: 11px; font-weight: 700; color: var(--text-secondary); border-bottom: 2px solid transparent; text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.15s; }
    .txm-chart-tab:hover { color: var(--text-primary); }
    .txm-chart-tab.active { color: ${GOLD}; border-bottom-color: ${GOLD}; }
    .txm-range-btn { background: var(--bg-surface-2); border: 1px solid var(--separator); color: var(--text-secondary); padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; cursor: pointer; font-family: inherit; letter-spacing: 0.5px; transition: all 0.15s; }
    .txm-range-btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }
    .txm-range-btn.active { background: ${GOLD_DIM}; border-color: ${GOLD}; color: ${GOLD}; }
    .txm-chart-svg { background: var(--bg-surface-2); border-radius: 10px; }
    .txm-chart-empty { text-align: center; color: var(--text-secondary); padding: 60px 20px; font-size: 13px; line-height: 1.6; }
    .txm-chart-summary { display: flex; justify-content: space-around; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--separator); flex-wrap: wrap; gap: 12px; }
    .txm-chart-stat { text-align: center; }
    .txm-chart-stat-num { font-family: var(--font-sans); font-size: 20px; font-weight: 800; color: ${GOLD}; line-height: 1; font-variant-numeric: tabular-nums; }
    .txm-chart-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-top: 4px; }
    .txm-recovery-tag { display: inline-block; padding: 3px 9px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .txm-recovery-sauna { background: rgba(239,68,68,0.2); color: #FF6B6B; }
    .txm-recovery-ice   { background: rgba(0,212,255,0.12); color: var(--accent); }
    .txm-recovery-rest  { background: var(--bg-surface-2); color: var(--text-secondary); }
    .txm-tab-bar { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--separator); flex-wrap: wrap; }
    .txm-tab { padding: 10px 14px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-secondary); border-bottom: 2px solid transparent; text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.15s; }
    .txm-tab:hover { color: var(--text-primary); }
    .txm-tab.active { color: ${GOLD}; border-bottom-color: ${GOLD}; }
    .txm-protocol-list { list-style: none; }
    .txm-protocol-list li { padding: 8px 0; font-size: 13px; display: flex; align-items: flex-start; gap: 10px; line-height: 1.5; border-bottom: 1px solid var(--separator); color: var(--text-secondary); }
    .txm-protocol-list li:last-child { border-bottom: none; }
    .txm-protocol-list li::before { content: '▸'; color: ${GOLD}; font-weight: 700; flex-shrink: 0; }
    .txm-reset-btn { background: transparent; border: 1px solid var(--separator); color: var(--text-secondary); padding: 5px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; font-family: inherit; }
    .txm-reset-btn:hover { background: var(--bg-surface-2); }
    .txm-helper { font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.5; }
    .txm-section-card { background: var(--bg-surface); border: 1px solid var(--separator); border-radius: var(--radius-lg); padding: 18px 20px; margin-bottom: 14px; }
    .txm-oura-card { margin-bottom: 14px; }
    .txm-oura-scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0; }
    .txm-oura-score-box { background: var(--bg-surface-2); border-radius: 10px; padding: 12px 8px; text-align: center; border: 1.5px solid transparent; transition: border-color 0.15s; cursor: pointer; }
    .txm-oura-score-box.active { border-color: ${GOLD}; }
    .txm-oura-score-num { font-family: var(--font-sans); font-size: 26px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
    .txm-oura-score-label { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-secondary); margin-top: 4px; }
    .txm-oura-durations { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .txm-oura-dur { background: var(--bg-surface-2); border-radius: 10px; padding: 10px 12px; text-align: center; }
    @keyframes txm-spin { to { transform: rotate(360deg); } }
    .txm-ai-btn { background: none; border: 1px solid rgba(0,212,255,0.3); color: var(--accent); padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; cursor: pointer; font-family: inherit; letter-spacing: 0.5px; transition: all 0.15s; flex-shrink: 0; }
    .txm-ai-btn:hover { background: rgba(0,212,255,0.1); }
    .txm-ai-refresh { background: none; border: 1px solid var(--separator); color: var(--text-tertiary); padding: 3px 8px; border-radius: 20px; font-size: 10px; cursor: pointer; font-family: inherit; transition: all 0.15s; flex-shrink: 0; }
    .txm-ai-refresh:hover { background: var(--bg-surface-2); }
    .txm-ai-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--separator); }
    .txm-ai-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .txm-ai-label-text { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-tertiary); font-weight: 700; }
    @media (max-width: 600px) {
      .txm-cd-num { font-size: 28px; }
      .txm-countdown { gap: 20px; }
      .txm-oura-scores { grid-template-columns: repeat(2, 1fr); }
    }
  `;
  document.head.appendChild(el);
  _styleEl = el;
}

// ── AI insight helpers ─────────────────────────────────────────
function aiBtn(key) {
  return `<button class="txm-ai-btn" data-txm="ai-insight" data-key="${key}">✦ AI</button>`;
}

function aiSection(key) {
  const ins = _insights[key];
  if (!ins.text && !ins.loading && !ins.error) return '';
  return `
    <div class="txm-ai-section">
      <div class="txm-ai-label">
        <span class="txm-ai-label-text">✦ AI Insight</span>
        ${ins.text ? `<button class="txm-ai-refresh" data-txm="ai-insight" data-key="${key}">↺ Refresh</button>` : ''}
      </div>
      ${ins.loading ? `
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary);font-style:italic">
          <div style="width:12px;height:12px;border:2px solid var(--separator);border-top-color:var(--accent);border-radius:50%;animation:txm-spin 0.7s linear infinite;flex-shrink:0"></div>
          Analyzing…
        </div>` :
      ins.error ? `<div style="font-size:12px;color:var(--color-red)">${ins.error}</div>` :
      `<div style="font-size:13px;color:var(--text-primary);line-height:1.6">${ins.text}</div>`}
    </div>`;
}

async function generateInsight(key) {
  const ins = _insights[key];
  if (!ins) return;
  _insights[key] = { text: null, loading: true, error: null };
  render();

  let prompt = '';
  const now = new Date();
  const dayOfWeek = now.getDay();
  const workout = WORKOUTS[dayOfWeek];
  const phase = getPhase(now);
  const h = _health;
  const o = _oura;

  if (key === 'health') {
    if (!h?.ok) { _insights[key] = { text: null, loading: false, error: 'No health data yet.' }; render(); return; }
    prompt = `You are a fitness coach giving Michael a quick plain-English read of his Apple Health data. Be direct and specific. 3-4 sentences max.

Today: ${h.steps_today ?? '—'} steps (goal 10k), ${h.calories_active_today ?? '—'} active kcal, ${h.exercise_minutes_today ?? '—'} min exercise, ${h.stand_hours_today ?? '—'} stand hours. VO2 Max: ${h.vo2_max ?? '—'} ml/kg·min (last measured). Resting HR: ${h.resting_hr ?? '—'} bpm.
${o ? `Sleep last night: ${o.sleep_score ?? '—'} sleep score, ${o.readiness_score ?? '—'} readiness.` : ''}

How is today's activity tracking vs his goals? Any standouts — good or needs attention? One actionable thing he can do right now.`;
  }

  else if (key === 'weight') {
    const wH = getWeightHistory();
    const entries = Object.entries(wH).sort((a,b) => a[0].localeCompare(b[0]));
    const first = entries[0]?.[1], cur = S.weight, lost = (START_WEIGHT - cur).toFixed(1), toGo = (cur - GOAL_WEIGHT).toFixed(1);
    const trend = entries.length >= 2 ? `started at ${entries[0][1]} lbs, now ${cur} lbs (${entries.length} weigh-ins over ${entries.length} days)` : `current ${cur} lbs`;
    prompt = `You are a fitness coach giving Michael a brief weight progress analysis. 3 sentences max. Be encouraging but honest.

Program: 40-day transformation, ${phase.phase === 'active' ? `day ${phase.dayNum} of 40` : `${phase.daysLeft} days until start`}. Start: ${START_WEIGHT} lbs, goal: ${GOAL_WEIGHT} lbs.
Progress: ${trend}. Lost: ${lost} lbs. Still needs: ${toGo} lbs.

How is he tracking toward his goal? Is the pace on target? One specific tip.`;
  }

  else if (key === 'protein') {
    prompt = `You are a nutrition coach. Michael's daily protein target is 150-180g (non-negotiable for muscle retention on a cut). 2-3 sentences max.

Right now: ${S.protein}g of ${PROTEIN_TARGET}g target (${Math.round(S.protein/PROTEIN_TARGET*100)}% of goal). Time of day: ${now.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'})}.

Is he on track to hit his target today? What should he do right now to hit it — suggest a specific food if he's behind.`;
  }

  else if (key === 'pullup') {
    prompt = `You are a strength coach. Michael is working toward his first pull-up. Be direct. 3 sentences max.

Current stats: ${S.pullup.hang}s dead hang (goal: 60s), ${S.pullup.neg} negatives (goal: 5), ${S.pullup.rows} inverted rows (goal: 12). Milestone: at 60s hang + 5 negatives + 12 rows → first pull-up attempt.

How close is he? Which metric is the weakest link right now? One specific coaching cue.`;
  }

  else if (key === 'recovery') {
    prompt = `You are a recovery coach. Michael's weekly recovery targets: 60+ min sauna, 10+ min ice bath. 2-3 sentences max.

This week: ${S.recovery.sauna} min sauna, ${S.recovery.ice} min ice bath. Day of week: ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek]}.

How is he tracking vs targets? Any scheduling advice given where he is in the week?`;
  }

  else if (key === 'workout') {
    prompt = `You are a kettlebell and conditioning coach. Give Michael a quick pre-workout mental frame for today's session. 2-3 sentences max. No fluff.

Today's workout (${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek]}): ${workout.name} — ${workout.sub}.
${o ? `Sleep readiness: ${o.readiness_score ?? '—'}/100. Sleep score: ${o.sleep_score ?? '—'}/100.` : ''}
${h?.ok ? `Steps today: ${h.steps_today ?? 0}. Exercise so far: ${h.exercise_minutes_today ?? 0} min.` : ''}

What's the mental key to today's session? Any adjustment based on his recovery status?`;
  }

  else if (key === 'checklist') {
    const completed = Object.values(S.checks).filter(Boolean).length;
    const total = DAILY_CHECKLIST.length;
    const done = DAILY_CHECKLIST.filter(i => S.checks[i.id]).map(i => i.text);
    const notDone = DAILY_CHECKLIST.filter(i => !S.checks[i.id]).map(i => i.text);
    prompt = `You are Michael's accountability coach. Quick assessment of his daily protocol. 2-3 sentences max.

Today's checklist: ${completed}/${total} done. Completed: ${done.join(', ') || 'none yet'}. Remaining: ${notDone.join(', ') || 'all done!'}.
Time: ${now.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'})}.

Quick read on where he stands — anything time-sensitive he needs to do now?`;
  }

  try {
    const { callAI } = await import('../js/ai.js');
    const text = await callAI(prompt, { maxTokens: 180 });
    _insights[key] = { text: text || 'No insight returned.', loading: false, error: null };
  } catch (e) {
    _insights[key] = { text: null, loading: false, error: 'Could not generate insight.' };
  }
  render();
}

// ── Render helpers ─────────────────────────────────────────────
function renderWorkoutHTML(workout) {
  const exp = S.workoutExpanded;
  let h = `<div class="txm-warmup"><span class="txm-warmup-label">Warm-Up</span>${workout.warmup}</div>`;
  if (exp) {
    workout.blocks.forEach(b => {
      h += `<div style="margin-bottom:14px"><div class="txm-section-title">${b.title}<span class="txm-section-time">${b.time}</span></div>`;
      b.moves.forEach(m => { h += `<div class="txm-move"><div class="txm-move-name">${m.name}</div><div class="txm-move-detail">${m.detail}</div></div>`; });
      h += `</div>`;
    });
    if (workout.cooldown) h += `<div class="txm-cooldown"><span style="color:var(--accent);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-right:6px">Cooldown</span>${workout.cooldown}</div>`;
    if (workout.scaling) h += `<div class="txm-meta"><strong>Scaling:</strong> ${workout.scaling}</div>`;
    if (workout.note)    h += `<div class="txm-meta"><strong>Coach's Note:</strong> ${workout.note}</div>`;
  } else {
    workout.blocks.forEach(b => {
      h += `<div style="margin-bottom:10px"><div class="txm-section-title">${b.title}<span class="txm-section-time">${b.time}</span></div>`;
      b.moves.forEach(m => { h += `<div style="font-size:12px;color:var(--text-secondary);padding:3px 0">• ${m.name}</div>`; });
      h += `</div>`;
    });
  }
  h += `<button class="txm-expand-btn" data-txm="toggle-workout">${exp ? '− Hide Details' : '+ Show Full Coaching'}</button>`;
  return h;
}

function render() {
  if (!_container) return;
  // RENPHO scale is always authoritative — prevent stale localStorage/Firestore from overriding it
  if (_renpho?.ok && _renpho.weight_lbs) S.weight = _renpho.weight_lbs;
  const now = new Date();
  const dayOfWeek = now.getDay();
  const workout = WORKOUTS[dayOfWeek];
  const phase = getPhase(now);
  const { daysLeft, subtitle } = phase;
  const lost = START_WEIGHT - S.weight;
  const toGo = S.weight - GOAL_WEIGHT;
  const pct = Math.max(0, Math.min(100, ((START_WEIGHT - S.weight) / (START_WEIGHT - GOAL_WEIGHT)) * 100));
  const pPct = Math.min(100, (S.protein / PROTEIN_TARGET) * 100);
  const pColor = S.protein >= 150 ? 'var(--color-green)' : S.protein >= 100 ? GOLD : 'var(--color-red)';

  let checklistHTML = '';
  let completed = 0;
  DAILY_CHECKLIST.forEach(item => {
    const done = !!S.checks[item.id];
    if (done) completed++;
    checklistHTML += `<li class="${done ? 'done' : ''}" data-txm="check" data-id="${item.id}">
      <div class="txm-checkbox"></div>
      <span class="txm-check-text">${item.text}</span>
      <span class="txm-check-time">${item.time}</span>
    </li>`;
  });

  let weekHTML = '';
  let weekCount = 0;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  DAY_LETTERS.forEach((letter, idx) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + idx);
    const dateNum = dayDate.getDate();
    let cls = 'txm-day-box';
    if (idx === dayOfWeek) cls += ' today';
    if (S.weekDone[idx]) { cls += ' done'; weekCount++; }
    weekHTML += `<div class="${cls}" data-txm="day" data-idx="${idx}">
      <div class="txm-day-letter">${letter}</div>
      <div class="txm-day-num">${S.weekDone[idx] ? '✓' : dateNum}</div>
    </div>`;
  });

  let tabBarHTML = '';
  Object.keys(TABS).forEach(key => {
    tabBarHTML += `<div class="txm-tab${S.activeTab === key ? ' active' : ''}" data-txm="tab" data-key="${key}">${TABS[key].label}</div>`;
  });
  const tab = TABS[S.activeTab];
  const tabContentHTML = `<h2 style="margin-bottom:14px;font-size:14px;font-weight:700;color:var(--text-primary)">${tab.title}</h2><ul class="txm-protocol-list">${tab.items.map(i => `<li>${i}</li>`).join('')}</ul>`;

  _container.innerHTML = `
    <div class="txm module-content">

      <!-- PROTOCOL HEADER — hidden; re-enable by removing display:none -->
      <div class="txm-header" style="display:none">
        <div class="txm-tagline">The Transformation Protocol</div>
        <div class="txm-title">${subtitle}</div>
        <div class="txm-countdown">
          ${phase.phase === 'active'
            ? `<div class="txm-cd-item"><div class="txm-cd-num">${phase.dayNum}</div><div class="txm-cd-label">Day</div></div>
               <div class="txm-cd-item"><div class="txm-cd-num">${daysLeft}</div><div class="txm-cd-label">Days Left</div></div>`
            : `<div class="txm-cd-item"><div class="txm-cd-num">${daysLeft}</div><div class="txm-cd-label">Days Left</div></div>
               <div class="txm-cd-item"><div class="txm-cd-num">${Math.floor(daysLeft / 7)}</div><div class="txm-cd-label">Weeks</div></div>`
          }
          <div class="txm-cd-item"><div class="txm-cd-num">${toGo > 0 ? toGo.toFixed(0) : '✓'}</div><div class="txm-cd-label">Lbs To Go</div></div>
        </div>
      </div>

      <div id="txm-oura-tile">${renderOuraTile()}</div>

      ${renderAppleHealthTile()}

      <div class="txm-grid">

        <div class="txm-card txm-workout-card">
          <h2>Today's Workout <span class="txm-recovery-tag txm-recovery-${workout.recovery}">${workout.recoveryLabel}</span> ${aiBtn('workout')}</h2>
          <div class="txm-workout-name">${workout.name}</div>
          <div class="txm-workout-sub">${workout.sub}</div>
          <div>${renderWorkoutHTML(workout)}</div>
          ${aiSection('workout')}
        </div>

        <div class="txm-card">
          <h2>Body Composition <span class="txm-badge">${lost > 0 ? '−' + lost.toFixed(1) + ' lbs' : lost < 0 ? '+' + Math.abs(lost).toFixed(1) + ' lbs' : 'Start'}</span> ${aiBtn('weight')}</h2>

          <!-- Big weight + date -->
          <div class="txm-weight-display" style="margin-bottom:2px">
            <span class="txm-weight-num">${S.weight.toFixed(1)}</span><span class="txm-weight-unit">lbs</span>
          </div>
          ${(_renpho?.measured_at || _health?.weight_date) ? `<div style="font-size:10px;color:var(--text-tertiary);text-align:center;margin-bottom:10px">📅 ${_renpho?.measured_at ? new Date(_renpho.measured_at * 1000 || _renpho.measured_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : _health?.weight_date}</div>` : ''}

          <!-- Full RENPHO body comp grid -->
          ${(() => {
            const r = _renpho?.ok ? _renpho : null;
            const h = _health || {};
            const bf  = r?.body_fat_pct  ?? h.body_fat_pct;
            const bmi = r?.bmi           ?? h.bmi;
            const lm  = r?.lean_mass_lbs ?? h.lean_mass_lbs;

            const stat = (val, label, color = 'var(--text-primary)', suffix = '') =>
              `<div style="text-align:center;padding:8px 4px;background:rgba(255,255,255,0.03);border-radius:8px">
                <div style="font-size:16px;font-weight:800;color:${color};line-height:1.2">${val != null ? val + suffix : '—'}</div>
                <div style="font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:var(--text-tertiary);margin-top:2px">${label}</div>
              </div>`;

            const bfColor  = bf  >= 30 ? 'var(--color-red)' : bf  >= 25 ? GOLD : 'var(--color-green)';
            const bmiColor = bmi >= 30 ? 'var(--color-red)' : bmi >= 25 ? GOLD : 'var(--color-green)';
            const vfColor  = (r?.visceral_fat ?? 0) >= 13 ? 'var(--color-red)' : (r?.visceral_fat ?? 0) >= 10 ? GOLD : 'var(--color-green)';

            return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:6px 0 10px">
              ${stat(bf?.toFixed(1),                      'Body Fat',       bfColor,  '%')}
              ${stat(lm?.toFixed(1),                      'Lean Mass',      'var(--color-green)', ' lb')}
              ${stat(bmi?.toFixed(1),                     'BMI',            bmiColor)}
              ${stat(r?.skeletal_muscle_pct?.toFixed(1),  'Skeletal Musc.', 'var(--color-green)', '%')}
              ${stat(r?.visceral_fat?.toFixed(0),         'Visceral Fat',   vfColor)}
              ${stat(r?.body_water_pct?.toFixed(1),       'Body Water',     'var(--accent)', '%')}
              ${stat(r?.subcutaneous_fat_pct?.toFixed(1), 'Subcut. Fat',    GOLD, '%')}
              ${stat(r?.bone_mass_lbs?.toFixed(1),        'Bone Mass',      'var(--text-secondary)', ' lb')}
              ${stat(r?.protein_pct?.toFixed(1),          'Protein',        'var(--color-green)', '%')}
              ${stat(r?.muscle_mass_lbs?.toFixed(1),      'Muscle Mass',    'var(--color-green)', ' lb')}
              ${stat(r?.bmr_kcal?.toFixed(0),             'BMR',            'var(--text-secondary)', ' kcal')}
              ${stat(r?.metabolic_age?.toFixed(0),        'Metabolic Age',  (r?.metabolic_age ?? 99) <= 40 ? 'var(--color-green)' : GOLD)}
            </div>
            ${!r ? `<div style="font-size:10px;color:var(--text-tertiary);text-align:center;margin-bottom:6px">⚠️ RENPHO bridge offline — add password to .env to unlock full stats</div>` : ''}`;
          })()}

          <!-- Weight goal progress bar -->
          <div class="txm-progress-bar"><div class="txm-progress-fill" style="width:${pct}%"></div></div>
          <div class="txm-progress-labels"><span>${START_WEIGHT} lbs</span><span>${pct.toFixed(0)}% to goal</span><span>${GOAL_WEIGHT} lbs</span></div>

          <!-- Manual override -->
          <div class="txm-input-row" style="margin-top:10px;opacity:${_renpho?.ok ? 0.5 : 1}">
            <input id="txm-weight-input" type="number" step="0.1" class="txm-input" placeholder="${_renpho?.ok ? 'Auto-synced from RENPHO' : 'Log today\'s weight'}">
            <button class="txm-btn txm-btn-gold" data-txm="log-weight">Log</button>
          </div>
          ${aiSection('weight')}
        </div>

        <div class="txm-card">
          <h2>Protein Today <span class="txm-badge">${S.protein}g / ${PROTEIN_TARGET}g</span> ${aiBtn('protein')}</h2>
          <div class="txm-macro-row">
            <span class="txm-macro-label">Target: 150-180g</span>
            <span class="txm-macro-value" style="color:${pColor}">${S.protein}g</span>
          </div>
          <div class="txm-macro-bar"><div class="txm-macro-fill" style="width:${pPct}%;background:${pColor}"></div></div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-tertiary);margin-bottom:5px;font-weight:700">Meals</div>
          <div class="txm-protein-btns" style="margin-bottom:8px">
            ${MEAL_SHORTCUTS.map(m => `<button class="txm-btn txm-btn-sm txm-btn-gold" data-txm="add-protein" data-amount="${m.g}" title="+${m.g}g">${m.label}</button>`).join('')}
          </div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-tertiary);margin-bottom:5px;font-weight:700">Quick Add</div>
          <div class="txm-protein-btns">
            ${[20,30,40,50].map(n => `<button class="txm-btn txm-btn-sm" data-txm="add-protein" data-amount="${n}">+${n}g</button>`).join('')}
            <button class="txm-btn txm-btn-sm" data-txm="add-protein" data-amount="-10" style="color:var(--text-secondary)">−10g</button>
          </div>
          <div class="txm-input-row">
            <input id="txm-protein-input" type="number" class="txm-input" placeholder="Custom amount (g)">
            <button class="txm-btn txm-btn-gold" data-txm="log-protein">Add</button>
          </div>
          ${aiSection('protein')}
        </div>

        <div class="txm-card">
          <h2>Today's Checklist <span class="txm-badge">${completed}/${DAILY_CHECKLIST.length}</span> ${aiBtn('checklist')}</h2>
          <ul class="txm-checklist">${checklistHTML}</ul>
          <div style="margin-top:12px;text-align:right">
            <button class="txm-reset-btn" data-txm="reset-day">Reset Day</button>
          </div>
          ${aiSection('checklist')}
        </div>

        <div class="txm-card">
          <h2>Pull-Up Progression <span class="txm-badge">Goal: 1 Rep</span> ${aiBtn('pullup')}</h2>
          <div class="txm-pull-stats">
            <div class="txm-stat-box">
              <div class="txm-stat-num">${S.pullup.hang}s</div>
              <div class="txm-stat-label">Dead Hang</div>
              <div class="txm-stat-btns">
                <button class="txm-btn txm-btn-sm" data-txm="pullup" data-key="hang" data-delta="-5">−</button>
                <button class="txm-btn txm-btn-sm" data-txm="pullup" data-key="hang" data-delta="5">+</button>
              </div>
            </div>
            <div class="txm-stat-box">
              <div class="txm-stat-num">${S.pullup.neg}</div>
              <div class="txm-stat-label">Negatives</div>
              <div class="txm-stat-btns">
                <button class="txm-btn txm-btn-sm" data-txm="pullup" data-key="neg" data-delta="-1">−</button>
                <button class="txm-btn txm-btn-sm" data-txm="pullup" data-key="neg" data-delta="1">+</button>
              </div>
            </div>
            <div class="txm-stat-box">
              <div class="txm-stat-num">${S.pullup.rows}</div>
              <div class="txm-stat-label">Inv. Rows</div>
              <div class="txm-stat-btns">
                <button class="txm-btn txm-btn-sm" data-txm="pullup" data-key="rows" data-delta="-1">−</button>
                <button class="txm-btn txm-btn-sm" data-txm="pullup" data-key="rows" data-delta="1">+</button>
              </div>
            </div>
          </div>
          <p class="txm-hint">Week 10 target: 60s hang • 5 negatives • 12 rows → 1st pull-up</p>
          ${aiSection('pullup')}
        </div>

        <div class="txm-card">
          <h2>Recovery This Week <span class="txm-badge">${S.recovery.sauna + S.recovery.ice} min total</span> ${aiBtn('recovery')}</h2>
          <div class="txm-recovery-stats">
            <div class="txm-stat-box" style="border-left:3px solid #FF6B6B">
              <div class="txm-stat-num" style="color:#FF6B6B">${S.recovery.sauna}</div>
              <div class="txm-stat-label">🔥 Sauna min</div>
              <div class="txm-stat-btns">
                <button class="txm-btn txm-btn-sm" data-txm="recovery" data-key="sauna" data-delta="-5">−5</button>
                <button class="txm-btn txm-btn-sm" data-txm="recovery" data-key="sauna" data-delta="5">+5</button>
                <button class="txm-btn txm-btn-sm" data-txm="recovery" data-key="sauna" data-delta="15">+15</button>
              </div>
            </div>
            <div class="txm-stat-box" style="border-left:3px solid var(--accent)">
              <div class="txm-stat-num" style="color:var(--accent)">${S.recovery.ice}</div>
              <div class="txm-stat-label">🧊 Ice bath min</div>
              <div class="txm-stat-btns">
                <button class="txm-btn txm-btn-sm" data-txm="recovery" data-key="ice" data-delta="-2">−2</button>
                <button class="txm-btn txm-btn-sm" data-txm="recovery" data-key="ice" data-delta="2">+2</button>
                <button class="txm-btn txm-btn-sm" data-txm="recovery" data-key="ice" data-delta="5">+5</button>
              </div>
            </div>
          </div>
          <p class="txm-hint">Target: 60+ min sauna • 10+ min cold per week. Resets every Sunday.</p>
          ${aiSection('recovery')}
        </div>

        <div class="txm-card">
          <h2>This Week <span class="txm-badge">${weekCount}/7</span></h2>
          <div class="txm-week-grid">${weekHTML}</div>
          <p class="txm-hint">Tap a day to mark training complete. Resets every Sunday.</p>
        </div>

      </div>

      ${renderTrendCard()}

      ${renderWorkoutsCard()}

      <div class="txm-section-card">
        <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-secondary);margin-bottom:14px;font-weight:700;display:flex;align-items:center;justify-content:space-between">
          Progress Charts <span class="txm-badge" id="txm-chart-badge">— entries</span>
        </h2>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px">
          <div class="txm-chart-tabs" style="margin-bottom:0;border-bottom:none">
            ${['weight','bodyfat','visceral'].map(t => `<div class="txm-chart-tab${S.activeChart === t ? ' active' : ''}" data-txm="chart-tab" data-chart="${t}">${{weight:'Weight',bodyfat:'Body Fat %',visceral:'Visceral Fat'}[t]}</div>`).join('')}
          </div>
          <div style="display:flex;gap:4px">
            ${['3M','6M','1Y','2Y','All'].map(r => `<button class="txm-range-btn${S.chartRange === r ? ' active' : ''}" data-txm="chart-range" data-range="${r}">${r}</button>`).join('')}
          </div>
        </div>
        <div style="height:1px;background:var(--separator);margin-bottom:12px"></div>
        <div id="txm-chart-container">
          <svg id="txm-chart-svg" class="txm-chart-svg" viewBox="0 0 700 280" preserveAspectRatio="xMidYMid meet" style="width:100%;height:280px"></svg>
          <div id="txm-chart-empty" class="txm-chart-empty" style="display:none">
            <p>No data yet for this range — sync your RENPHO scale to populate charts.</p>
          </div>
        </div>
      </div>

<!-- PROTOCOL SECTION — hidden for now, re-enable by removing display:none -->
      <div class="txm-section-card" style="display:none">
        <div class="txm-tab-bar">${tabBarHTML}</div>
        <div id="txm-tab-content">${tabContentHTML}</div>
      </div>

    </div>
  `;

  renderChart();
  bindEvents();
}

function renderChart() {
  const svg = _container?.querySelector('#txm-chart-svg');
  const empty = _container?.querySelector('#txm-chart-empty');
  if (!svg || !empty) return;
  const type = S.activeChart;

  let history, goal, label;
  if (type === 'weight') {
    history = filterByRange(Object.entries(getWeightHistory()).map(([d,v]) => ({ date:d, value:parseFloat(v) })).sort((a,b) => a.date.localeCompare(b.date)));
    goal = GOAL_WEIGHT; label = 'lbs';
  } else if (type === 'bodyfat') {
    history = filterByRange(Object.entries(getBfHistory()).map(([d,v]) => ({ date:d, value:parseFloat(v) })).sort((a,b) => a.date.localeCompare(b.date)));
    goal = 20; label = '%';
  } else if (type === 'visceral') {
    history = filterByRange(Object.entries(getVfHistory()).map(([d,v]) => ({ date:d, value:parseFloat(v) })).sort((a,b) => a.date.localeCompare(b.date)));
    goal = 9; label = '';
  } else {
    history = []; goal = null; label = '';
  }

  const badge = _container?.querySelector('#txm-chart-badge');
  if (badge) badge.textContent = history.length + (history.length === 1 ? ' entry' : ' entries');

  if (history.length === 0) {
    svg.style.display = 'none'; empty.style.display = 'block'; return;
  }
  svg.style.display = 'block'; empty.style.display = 'none';

  const W=700,H=280,m={top:30,right:50,bottom:50,left:60};
  const cW=W-m.left-m.right, cH=H-m.top-m.bottom;
  const vals=[...history.map(d=>d.value),goal];
  const minV=Math.min(...vals),maxV=Math.max(...vals),pad=Math.max((maxV-minV)*0.15,1);
  const yMin=Math.max(0,minV-pad),yMax=maxV+pad;
  const xS=(i)=>history.length===1?m.left+cW/2:m.left+(i/(history.length-1))*cW;
  const yS=(v)=>m.top+cH-((v-yMin)/(yMax-yMin))*cH;

  let h=`<defs><linearGradient id="txmGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:${GOLD};stop-opacity:0.4"/><stop offset="100%" style="stop-color:${GOLD};stop-opacity:0"/></linearGradient></defs>`;
  for(let i=0;i<=4;i++){const y=m.top+(i/4)*cH,v=yMax-(i/4)*(yMax-yMin);h+=`<line stroke="var(--separator)" stroke-width="1" x1="${m.left}" y1="${y}" x2="${W-m.right}" y2="${y}"/><text fill="var(--text-tertiary)" font-size="10" font-family="Inter,sans-serif" x="${m.left-8}" y="${y+4}" text-anchor="end">${v.toFixed(0)}</text>`;}
  if(goal!=null&&goal>=yMin&&goal<=yMax){const gY=yS(goal);h+=`<line stroke="var(--color-green)" stroke-width="2" stroke-dasharray="6 4" opacity="0.7" x1="${m.left}" y1="${gY}" x2="${W-m.right}" y2="${gY}"/><text fill="var(--color-green)" font-size="10" font-weight="700" font-family="Inter,sans-serif" x="${W-m.right+6}" y="${gY+4}">GOAL ${goal}${label}</text>`;}
  if(history.length>=2){let a=`M ${xS(0)} ${yS(history[0].value)}`,l=a;history.forEach((d,i)=>{if(i>0){a+=` L ${xS(i)} ${yS(d.value)}`;l+=` L ${xS(i)} ${yS(d.value)}`;}}); a+=` L ${xS(history.length-1)} ${m.top+cH} L ${xS(0)} ${m.top+cH} Z`;h+=`<path fill="url(#txmGrad)" opacity="0.3" d="${a}"/><path fill="none" stroke="${GOLD}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${l}"/>`;}
  history.forEach((d,i)=>{const x=xS(i),y=yS(d.value),isL=i===history.length-1;h+=`<circle cx="${x}" cy="${y}" r="${isL?6:4}" fill="${isL?'var(--bg-surface)':GOLD}" stroke="${GOLD}" stroke-width="${isL?3:2}"/>`;if(isL)h+=`<text fill="var(--text-primary)" font-size="11" font-weight="700" font-family="Inter,sans-serif" x="${x}" y="${y-14}" text-anchor="middle">${d.value} ${label}</text>`;});
  const li=history.length===1?[0]:history.length<=4?history.map((_,i)=>i):[0,Math.floor(history.length/2),history.length-1];
  li.forEach(i=>{const d=history[i],[,m2,d2]=d.date.split('-');const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];h+=`<text fill="var(--text-tertiary)" font-size="10" font-family="Inter,sans-serif" x="${xS(i)}" y="${H-20}" text-anchor="middle">${months[parseInt(m2)-1]} ${parseInt(d2)}</text>`;});
  svg.innerHTML=h;

  // Summary stats
  const old=_container?.querySelector('#txm-chart-summary');
  if(old)old.remove();
  if(history.length===0)return;
  const first=history[0].value,cur=history[history.length-1].value,change=cur-first,toGoal=goal!=null?cur-goal:null;
  const isLower=type==='weight'||type==='bodyfat'||type==='visceral',good=isLower?change<0:change>0;
  const changeColor=change===0?'var(--text-secondary)':good?'var(--color-green)':'var(--color-red)';
  const u=type==='weight'?' lbs':type==='bodyfat'?'%':'';
  const dec=type==='weight'?1:type==='bodyfat'?1:0;
  const div=document.createElement('div');div.id='txm-chart-summary';div.className='txm-chart-summary';
  div.innerHTML=`<div class="txm-chart-stat"><div class="txm-chart-stat-num">${first.toFixed(dec)}${u}</div><div class="txm-chart-stat-label">Start</div></div><div class="txm-chart-stat"><div class="txm-chart-stat-num">${cur.toFixed(dec)}${u}</div><div class="txm-chart-stat-label">Current</div></div><div class="txm-chart-stat"><div class="txm-chart-stat-num" style="color:${changeColor}">${change>0?'+':''}${change.toFixed(dec)}${u}</div><div class="txm-chart-stat-label">Change</div></div>${toGoal!=null?`<div class="txm-chart-stat"><div class="txm-chart-stat-num">${Math.max(0,toGoal).toFixed(dec)}${u}</div><div class="txm-chart-stat-label">To Goal</div></div>`:''}`;
  _container?.querySelector('#txm-chart-container')?.appendChild(div);
}

// ── Event binding (delegation on container) ────────────────────
function bindEvents() {
  if (!_container) return;
  _container.removeEventListener('click', handleClick);
  _container.addEventListener('click', handleClick);

  const wi = _container.querySelector('#txm-weight-input');
  const pi = _container.querySelector('#txm-protein-input');
  if (wi) wi.addEventListener('keydown', e => { if (e.key==='Enter') doLogWeight(); });
  if (pi) pi.addEventListener('keydown', e => { if (e.key==='Enter') doLogProtein(); });
}

function handleClick(e) {
  const el = e.target.closest('[data-txm]');
  if (!el) return;
  const action = el.dataset.txm;

  if (action === 'log-weight')    { doLogWeight(); }
  else if (action === 'log-protein')  { doLogProtein(); }
  else if (action === 'add-protein')  { S.protein = Math.max(0, S.protein + parseInt(el.dataset.amount)); txSave(); render(); return; }
  else if (action === 'pullup')   { S.pullup[el.dataset.key] = Math.max(0, S.pullup[el.dataset.key] + parseInt(el.dataset.delta)); txSave(); render(); return; }
  else if (action === 'recovery') { S.recovery[el.dataset.key] = Math.max(0, S.recovery[el.dataset.key] + parseInt(el.dataset.delta)); txSave(); render(); return; }
  else if (action === 'check')    { const id=el.dataset.id; S.checks[id]=!S.checks[id]; _localDirty=true; txSave(); render(); return; }
  else if (action === 'day')      { const idx=parseInt(el.dataset.idx); S.weekDone[idx]=!S.weekDone[idx]; txSave(); render(); return; }
  else if (action === 'tab')      { S.activeTab=el.dataset.key; render(); return; }
  else if (action === 'chart-tab')  { S.activeChart=el.dataset.chart; render(); return; }
  else if (action === 'chart-range'){ S.chartRange=el.dataset.range; render(); return; }
  else if (action === 'toggle-workout') { S.workoutExpanded=!S.workoutExpanded; render(); return; }
  else if (action === 'oura-section')   { const s=el.dataset.section; _ouraSection=_ouraSection===s?null:s; const t=_container.querySelector('#txm-oura-tile'); if(t) t.innerHTML=renderOuraTile(); return; }
  else if (action === 'oura-sync')      { syncOuraNow(); return; }
  else if (action === 'toggle-workouts') { _workoutsExpanded=!_workoutsExpanded; render(); return; }
  else if (action === 'sleep-insight')  { generateSleepInsight(); return; }
  else if (action === 'ai-insight')     { generateInsight(el.dataset.key); return; }
  else if (action === 'reset-day')  { if(confirm("Reset today's checklist and protein?")){ S.checks={}; S.protein=0; _localDirty=true; txSave(); render(); } return; }

}

function doLogWeight() {
  const input = _container?.querySelector('#txm-weight-input');
  const v = parseFloat(input?.value);
  if (!isNaN(v) && v > 50 && v < 500) { S.weight = v; if(input) input.value = ''; txSave(); render(); }
}
function doLogProtein() {
  const input = _container?.querySelector('#txm-protein-input');
  const v = parseInt(input?.value);
  if (!isNaN(v) && v > 0) { S.protein = Math.max(0, S.protein + v); if(input) input.value = ''; txSave(); render(); }
}

// ── Oura sync ──────────────────────────────────────────────────
// Two-path approach: bridge (fast, desktop) + Firestore (live, all devices)
const BRIDGE = 'http://localhost:3333';
const OURA_FS_URL = `https://firestore.googleapis.com/v1/projects/inner-circle-crm/databases/(default)/documents/users/owner-inner-circle-crm/sync/oura?key=AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4`;
let _ouraFsPollTimer = null;

// Parse a Firestore field value back to a plain JS value
function fsVal(v) {
  if (!v) return null;
  if ('nullValue'     in v) return null;
  if ('booleanValue'  in v) return v.booleanValue;
  if ('integerValue'  in v) return parseInt(v.integerValue);
  if ('doubleValue'   in v) return v.doubleValue;
  if ('stringValue'   in v) return v.stringValue;
  if ('timestampValue'in v) return v.timestampValue;
  if ('arrayValue'    in v) return (v.arrayValue.values || []).map(fsVal);
  if ('mapValue'      in v) {
    const fields = v.mapValue.fields || {};
    return Object.fromEntries(Object.entries(fields).map(([k, fv]) => [k, fsVal(fv)]));
  }
  return null;
}

async function fetchOuraFromFirestore() {
  try {
    const res = await fetch(OURA_FS_URL);
    if (!res.ok) return;
    const doc = await res.json();
    if (!doc.fields) return;
    const data = Object.fromEntries(
      Object.entries(doc.fields).map(([k, v]) => [k, fsVal(v)])
    );
    // Only update if this is newer than what we have
    if (!_oura || (data.lastSync && (!_oura.lastSync || data.lastSync > _oura.lastSync))) {
      _oura = { ...data, ok: true };
      _ouraInsight = { text: null, loading: false, error: null };
      render();
    }
  } catch {
    // silent fail
  }
}

async function fetchOuraFromBridge() {
  try {
    const res = await fetch(`${BRIDGE}/oura`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;
    _oura = data;
    render();
  } catch {
    // bridge not running — Firestore path covers it
  }
}

async function fetchOura() {
  await Promise.allSettled([fetchOuraFromBridge(), fetchOuraFromFirestore()]);
}

async function fetchShortcutWorkouts() {
  try {
    const BRIDGE = localStorage.getItem('os_bridge_url') || 'http://localhost:3333';
    const res = await fetch(`${BRIDGE}/shortcut-workouts`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.ok && Array.isArray(data.workouts) && data.workouts.length) {
      _shortcutWorkouts = data.workouts;
      render();
    }
  } catch {}
}

async function syncOuraNow() {
  const btn = _container?.querySelector('#txm-oura-sync-btn');
  if (btn) { btn.style.color = GOLD; btn.style.animation = 'txm-spin 0.7s linear infinite'; }
  try {
    const BRIDGE = localStorage.getItem('os_bridge_url') || 'http://localhost:3333';
    const res = await fetch(`${BRIDGE}/refresh-oura`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (data.ok) { _oura = data; _ouraInsight = { text: null, loading: false, error: null }; render(); }
  } catch {}
  if (btn) { btn.style.color = ''; btn.style.animation = ''; }
}

function startOuraPolling() {
  // Poll Firestore every 5 minutes — catches updates from phone without needing the bridge
  _ouraFsPollTimer = setInterval(fetchOuraFromFirestore, 5 * 60 * 1000);
}

function stopOuraPolling() {
  clearInterval(_ouraFsPollTimer);
  _ouraFsPollTimer = null;
}

// ── Apple Health fetch ─────────────────────────────────────────────────────

const HEALTH_FS_URL = `https://firestore.googleapis.com/v1/projects/inner-circle-crm/databases/(default)/documents/users/owner-inner-circle-crm/sync/apple_health?key=AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4`;

// Auto-sync weight (and body fat) from Apple Health data into S.weight + history
function syncWeightFromHealth(h) {
  if (!h?.weight_lbs) return;
  const date = h.weight_date || todayKey();
  // Update current weight
  S.weight = h.weight_lbs;
  // Add to history keyed by the measurement date
  const wH = JSON.parse(localStorage.getItem('transformation_weight_history') || '{}');
  wH[date] = h.weight_lbs;
  localStorage.setItem('transformation_weight_history', JSON.stringify(wH));
  localStorage.setItem('transformation_weight', String(h.weight_lbs));
  txPushFirestore();
}

async function fetchAppleHealth() {
  // Try bridge first (Mac), then Firestore fallback (iPhone)
  try {
    const BRIDGE = localStorage.getItem("os_bridge_url") || "http://localhost:3333";
    const res = await fetch(`${BRIDGE}/apple-health`, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    if (data.ok) {
      _health = data;
      syncWeightFromHealth(data);
      render();
      return;
    }
  } catch {}

  // Firestore fallback
  try {
    const res = await fetch(HEALTH_FS_URL);
    const doc = await res.json();
    const f = doc.fields;
    if (!f) return;
    const num = (k) => f[k] ? (parseFloat(f[k].doubleValue ?? f[k].integerValue ?? 0) || null) : null;
    const str = (k) => f[k]?.stringValue || null;
    const arr = (k) => f[k]?.arrayValue?.values?.map(v => {
      const m = v.mapValue?.fields || {};
      return { date: m.date?.stringValue, steps: parseInt(m.steps?.integerValue ?? 0) };
    }) || null;
    _health = {
      ok: true,
      date: str("date"),
      steps_today:             num("steps_today"),
      calories_active_today:   num("calories_active_today"),
      exercise_minutes_today:  num("exercise_minutes_today"),
      stand_hours_today:       num("stand_hours_today"),
      weight_lbs:              num("weight_lbs"),
      weight_date:             str("weight_date"),
      body_fat_pct:            num("body_fat_pct"),
      body_fat_date:           str("body_fat_date"),
      lean_mass_lbs:           num("lean_mass_lbs"),
      bmi:                     num("bmi"),
      vo2_max:                 num("vo2_max"),
      resting_hr:              num("resting_hr"),
      steps_7day:              arr("steps_7day"),
    };
    syncWeightFromHealth(_health);
    render();
  } catch {}
}

async function fetchRenpho() {
  try {
    const BRIDGE = localStorage.getItem('os_bridge_url') || 'http://localhost:3333';
    const res  = await fetch(`${BRIDGE}/renpho`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (data.ok) {
      _renpho = data;
      syncWeightFromHealth(data);
      // Store historical body fat + visceral fat from April 1
      if (data.history?.length) {
        const wH = {}, bfH = {}, vfH = {};
        data.history.forEach(m => {
          if (m.date && m.weight_lbs   != null) wH[m.date]  = m.weight_lbs;
          if (m.date && m.body_fat_pct != null) bfH[m.date] = m.body_fat_pct;
          if (m.date && m.visceral_fat != null) vfH[m.date] = m.visceral_fat;
        });
        // Merge weight history (RENPHO wins for dates it has data)
        const existingWH = JSON.parse(localStorage.getItem('transformation_weight_history') || '{}');
        localStorage.setItem('transformation_weight_history', JSON.stringify({ ...existingWH, ...wH }));
        localStorage.setItem('transformation_bf_history', JSON.stringify(bfH));
        localStorage.setItem('transformation_vf_history', JSON.stringify(vfH));
        txPushFirestore(); // sync the full history up so Firestore stops overwriting it
      }
      render();
    }
  } catch {}
}

function secToHM(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function scoreColor(n) {
  if (n == null) return 'var(--text-tertiary)';
  if (n >= 85) return 'var(--color-green)';
  if (n >= 70) return GOLD;
  return 'var(--color-red)';
}

function renderAppleHealthTile() {
  // Apple Health is now merged into the Oura tile — nothing to render separately
  return '';
}

async function generateSleepInsight() {
  if (!_oura) return;
  _ouraInsight = { text: null, loading: true, error: null };
  render();
  const o = _oura;
  const h = _health;
  const healthLine = h?.ok ? `
Yesterday's activity: ${h.steps_today ?? '—'} steps, ${h.calories_active_today ?? '—'} active kcal, ${h.exercise_minutes_today ?? '—'} min exercise, ${h.stand_hours_today ?? '—'} stand hours. VO2 Max: ${h.vo2_max ?? '—'}.` : '';

  const contrib = o.sleep_contributors || {};
  const rContrib = o.readiness_contributors || {};
  const prompt = `You are a health coach giving Michael a plain-English interpretation of his Oura ring data. Be direct, specific, and actionable. 4-5 sentences max.

Date: ${o.date || 'last night'}
SLEEP: Score ${o.sleep_score ?? '—'} | Total ${secToHM(o.total_sleep_sec)} | Deep ${secToHM(o.deep_sleep_sec)} | REM ${secToHM(o.rem_sleep_sec)} | Efficiency ${o.sleep_efficiency ?? '—'}% | Bedtime ${fmtTime(o.bedtime_start)}–${fmtTime(o.bedtime_end)}
VITALS: HRV ${o.avg_hrv ?? '—'} ms | Resting HR ${o.resting_hr ?? '—'} bpm | SpO2 ${o.spo2_avg ?? '—'}% | Breathing disturbance index ${o.breathing_disturbance_idx ?? '—'} | Temp deviation ${o.temperature_deviation ?? '—'}°
READINESS: Score ${o.readiness_score ?? '—'} | HRV balance ${rContrib.hrv_balance ?? '—'} | Recovery index ${rContrib.recovery_index ?? '—'}
ACTIVITY: Score ${o.activity_score ?? '—'} | Steps ${o.steps ?? '—'} | Active cal ${o.active_calories ?? '—'} | High intensity ${o.high_activity_min ?? '—'}m | Sedentary ${o.sedentary_min ?? '—'}m
STRESS: ${o.stress_summary ?? '—'} | Stress ${o.stress_high_min ?? '—'}m | Recovery ${o.recovery_high_min ?? '—'}m
${healthLine}

What does this data mean for Michael today? Connect the dots across sleep, recovery, and activity. Highlight 1-2 strengths and 1 clear thing to improve. Natural paragraph, no bullet points.`;

  try {
    const { callAI } = await import('../js/ai.js');
    const text = await callAI(prompt, { maxTokens: 200 });
    _ouraInsight = { text: text || 'No insight returned.', loading: false, error: null };
  } catch (e) {
    _ouraInsight = { text: null, loading: false, error: 'Could not generate insight. Check your API key.' };
  }
  render();
}

function fmtTime(iso) {
  if (!iso) return '—';
  const t = iso.includes('T') ? iso.split('T')[1]?.slice(0,5) : iso.slice(0,5);
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function contribBar(label, val) {
  if (val == null) return '';
  const color = val >= 85 ? 'var(--color-green)' : val >= 70 ? GOLD : 'var(--color-red)';
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0">
    <span style="font-size:11px;color:var(--text-secondary)">${label}</span>
    <span style="font-size:12px;font-weight:700;color:${color}">${val}</span>
  </div>`;
}

function miniStatBox(icon, val, label, color) {
  if (val == null) return '';
  return `<div style="background:var(--bg-surface-2);border-radius:10px;padding:10px 8px;text-align:center">
    <div style="font-size:11px;margin-bottom:2px">${icon}</div>
    <div style="font-size:16px;font-weight:800;color:${color};font-family:'Space Grotesk',sans-serif;line-height:1">${val}</div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-tertiary);margin-top:2px">${label}</div>
  </div>`;
}

function renderTrendCard() {
  const o = _oura;
  if (!o) return '';
  const trend = Array.isArray(o.trend_120day) ? o.trend_120day : (Array.isArray(o.trend_7day) ? o.trend_7day : []);
  if (trend.length < 2) return '';
  const zepboundStart = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0,10); })();
  const W = 480, H = 110, PAD = { t: 8, r: 8, b: 18, l: 24 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
  const n = trend.length;
  const xOf = i => PAD.l + (i / (n - 1)) * cW;
  const yOf = v => v == null ? null : PAD.t + cH - ((v - 40) / 60) * cH;
  const line = (key, color) => {
    const segs = []; let seg = [];
    trend.forEach((d, i) => {
      const y = yOf(d[key]);
      if (y == null) { if (seg.length) { segs.push(seg); seg = []; } }
      else seg.push(`${xOf(i).toFixed(1)},${y.toFixed(1)}`);
    });
    if (seg.length) segs.push(seg);
    return segs.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`).join('');
  };
  const zbIdx = trend.findIndex(d => d.day >= zepboundStart);
  const zbLine = zbIdx >= 0 ? `
    <line x1="${xOf(zbIdx).toFixed(1)}" y1="${PAD.t}" x2="${xOf(zbIdx).toFixed(1)}" y2="${PAD.t+cH}" stroke="${GOLD}" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/>
    <text x="${(xOf(zbIdx)+3).toFixed(1)}" y="${(PAD.t+7).toFixed(1)}" font-size="7" fill="${GOLD}" opacity="0.9">Zepbound</text>
  ` : '';
  const monthLabels = [];
  trend.forEach((d, i) => {
    if (!d.day) return;
    const dt = new Date(d.day + 'T12:00:00');
    if (dt.getDate() === 1 || i === 0)
      monthLabels.push(`<text x="${xOf(i).toFixed(1)}" y="${H-2}" font-size="7" fill="var(--text-tertiary)" text-anchor="middle">${dt.toLocaleDateString('en-US',{month:'short'})}</text>`);
  });
  const gridLines = [70, 85].map(v => {
    const y = yOf(v).toFixed(1);
    return `<line x1="${PAD.l}" y1="${y}" x2="${PAD.l+cW}" y2="${y}" stroke="var(--separator)" stroke-width="0.5"/>
            <text x="${PAD.l-3}" y="${(parseFloat(y)+3).toFixed(1)}" font-size="7" fill="var(--text-tertiary)" text-anchor="end">${v}</text>`;
  }).join('');
  return `
    <div class="txm-section-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-secondary);font-weight:700;margin:0">120-Day Score Trend</h2>
        <div style="display:flex;gap:10px">
          <span style="font-size:9px;color:#AF52DE">● Sleep</span>
          <span style="font-size:9px;color:var(--color-green)">● Readiness</span>
          <span style="font-size:9px;color:var(--accent)">● Activity</span>
        </div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;overflow:visible">
        ${gridLines}
        ${zbLine}
        ${line('sleep',     '#AF52DE')}
        ${line('readiness', 'var(--color-green)')}
        ${line('activity',  'var(--accent)')}
        ${monthLabels.join('')}
      </svg>
    </div>`;
}

const WORKOUT_ICONS = {
  'Running': '🏃', 'Cycling': '🚴', 'Walking': '🚶', 'Swimming': '🏊',
  'Strength Training': '🏋️', 'Functional Strength': '🏋️', 'Hiit': '⚡', 'HIIT': '⚡',
  'Yoga': '🧘', 'Hiking': '🥾', 'Tennis': '🎾', 'Pickleball': '🏓',
  'Basketball': '🏀', 'Baseball': '⚾', 'Soccer': '⚽', 'Softball': '🥎',
  'Rowing': '🚣', 'Elliptical': '🔄', 'Stair Climbing': '🪜',
  'Core Training': '💪', 'Cross Training': '🔀', 'Mixed Cardio': '❤️',
  'Pilates': '🤸', 'Dance': '💃', 'Jump Rope': '⭕', 'Boxing': '🥊',
  'Climbing': '🧗', 'Golf': '⛳', 'Yardwork': '🌿', 'Housework': '🏠',
  'Workout': '💪',
};
const fmtWorkoutName = s => s ? s.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Workout';

function workoutRow(w, showDate = true) {
  const icon  = WORKOUT_ICONS[w.activity] || WORKOUT_ICONS[fmtWorkoutName(w.activity)] || '💪';
  const date  = w.date ? new Date(w.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const stats = [
    w.duration_min ? `${w.duration_min} min` : null,
    w.calories     ? `${w.calories} kcal`    : null,
    w.distance_km  ? `${w.distance_km} km`   : null,
    w.avg_hr       ? `♥ ${w.avg_hr} bpm`     : null,
  ].filter(Boolean).join(' · ');
  const srcColor = w.source === 'Apple Health' ? '#6B8CFF' : GOLD;
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--separator)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px;line-height:1">${icon}</span>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${w.activity}</div>
          ${showDate ? `<div style="font-size:10px;color:var(--text-tertiary)">${date} <span style="color:${srcColor};font-weight:600">${w.source}</span></div>` : ''}
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:var(--text-secondary)">${stats}</div>
    </div>`;
}

function mergedWorkouts() {
  // Oura: all sessions, no internal dedup (3 walks on same day = 3 real sessions)
  const oura = (Array.isArray(_oura?.workouts) ? _oura.workouts : []).map(w => ({
    activity: fmtWorkoutName(w.activity),
    date: w.day || '',
    duration_min: w.duration_min,
    calories: w.calories || null,
    distance_km: w.distance_km > 0.1 ? w.distance_km : null,
    source: 'Oura',
  }));

  // Shortcut workouts from iCloud (Apple Health, includes Health-imported activities)
  const shortcut = _shortcutWorkouts.map(w => ({
    activity: w.activity || 'Workout',
    date: w.date || '',
    duration_min: w.duration_min || null,
    calories: w.calories || null,
    distance_km: w.distance_km || null,
    avg_hr: w.avg_hr || null,
    source: 'Apple Health',
  }));

  // HealthKit binary workouts (when available)
  const healthKit = (Array.isArray(_health?.workouts) ? _health.workouts : []).map(w => ({
    activity: w.activity, date: w.date||'', duration_min: w.duration_min,
    calories: w.calories||null, distance_km: w.distance_km||null,
    avg_hr: w.avg_hr||null, source: 'Apple Health',
  }));

  // Dedup Apple Health sources against each other and against Oura
  // Key: date + activity + duration (within 2 min = same session)
  const ouraKeys = new Set(oura.map(w => `${w.date}|${w.activity}`));
  const seen = new Set();
  const ah = [...shortcut, ...healthKit].filter(w => {
    if (ouraKeys.has(`${w.date}|${w.activity}`)) return false;
    const key = `${w.date}|${w.activity}|${Math.round((w.duration_min||0)/2)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  return [...ah, ...oura].sort((a, b) => b.date > a.date ? 1 : b.date < a.date ? -1 : 0);
}

function renderWorkoutsCard() {
  const all = mergedWorkouts();
  if (!all.length) return '';

  // Group by date for the timeline
  const byDate = [];
  let curDate = null, curGroup = [];
  all.forEach(w => {
    if (w.date !== curDate) {
      if (curGroup.length) byDate.push({ date: curDate, workouts: curGroup });
      curDate = w.date; curGroup = [w];
    } else { curGroup.push(w); }
  });
  if (curGroup.length) byDate.push({ date: curDate, workouts: curGroup });

  // Always show the 2 most recent days; rest behind toggle
  const alwaysShow = byDate.slice(0, 2);
  const hidden     = byDate.slice(2);

  const renderDay = g => {
    const label = new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    return `
      <div style="margin-bottom:4px">
        <div style="font-size:10px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px;padding:6px 0 2px">${label}</div>
        ${g.workouts.map(w => workoutRow(w, false)).join('')}
      </div>`;
  };

  const hasAH = (_shortcutWorkouts.length || _health?.workouts?.length);
  const badge = hasAH ? 'Apple Health + Oura' : 'Oura';
  const totalSessions = all.length;
  return `
    <div class="txm-section-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-secondary);font-weight:700;margin:0">
          Workout Log <span class="txm-badge" style="margin-left:8px">${badge}</span>
        </h2>
        ${hidden.length ? `<button data-txm="toggle-workouts" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--text-tertiary);padding:0">
          ${_workoutsExpanded ? '▲ less' : `▽ +${hidden.reduce((n,g)=>n+g.workouts.length,0)} more`}
        </button>` : ''}
      </div>
      ${alwaysShow.map(renderDay).join('')}
      ${_workoutsExpanded ? hidden.map(renderDay).join('') : ''}
    </div>`;
}

function renderOuraTile() {
  const o = _oura;
  if (!o) {
    return `
      <div class="txm-card txm-oura-card">
        <h2>Body Stats <span class="txm-badge">Oura Ring</span></h2>
        <div style="padding:20px 0;text-align:center;color:var(--text-tertiary);font-size:13px">
          Waiting for bridge… start <code style="color:var(--accent)">serve_os.py</code>
        </div>
      </div>`;
  }

  const sleepScore    = o.sleep_score ?? null;
  const readyScore    = o.readiness_score ?? null;
  const actScore      = o.activity_score ?? null;
  const hrv           = o.avg_hrv != null ? `${o.avg_hrv}` : '—';
  const restHR        = o.resting_hr != null ? `${o.resting_hr}` : '—';
  const spo2          = o.spo2_avg != null ? `${o.spo2_avg}%` : null;
  const tempDev       = o.temperature_deviation != null ? `${o.temperature_deviation > 0 ? '+' : ''}${o.temperature_deviation.toFixed(2)}°` : null;
  const steps         = o.steps != null ? o.steps.toLocaleString() : '—';
  const stepsColor    = (o.steps||0) >= 10000 ? 'var(--color-green)' : (o.steps||0) >= 6000 ? GOLD : 'var(--color-red)';
  const activeCal     = o.active_calories != null ? `${o.active_calories}` : null;
  const totalCal      = o.total_calories != null ? `${o.total_calories}` : null;
  const stressLabel   = { normal: '😌 Normal', high: '😤 High', low: '😴 Low', restored: '✨ Restored' }[o.stress_summary] || o.stress_summary || null;
  const stressColor   = { normal: 'var(--color-green)', high: 'var(--color-red)', low: 'var(--accent)', restored: GOLD }[o.stress_summary] || 'var(--text-secondary)';
  const bdi           = o.breathing_disturbance_idx;
  const bdiColor      = bdi == null ? 'var(--text-tertiary)' : bdi <= 5 ? 'var(--color-green)' : bdi <= 15 ? GOLD : 'var(--color-red)';
  const sleepContrib  = o.sleep_contributors || {};
  const readyContrib  = o.readiness_contributors || {};
  const actContrib    = o.activity_contributors || {};
  const workouts      = Array.isArray(o.workouts) ? o.workouts : [];
  const trend         = Array.isArray(o.trend_120day) ? o.trend_120day : (Array.isArray(o.trend_7day) ? o.trend_7day : []);
  // Zepbound start — 60 days before today
  const zepboundStart = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0,10); })();
  const ins           = _ouraInsight;

  // 120-day SVG line chart
  const trendChart = (() => {
    if (!trend.length) return '';
    const W = 480, H = 90, PAD = { t: 8, r: 8, b: 18, l: 24 };
    const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
    const n = trend.length;
    const xOf = i => PAD.l + (i / (n - 1)) * cW;
    const yOf = v => v == null ? null : PAD.t + cH - ((v - 40) / 60) * cH;
    const line = (key, color) => {
      const pts = trend.map((d, i) => { const y = yOf(d[key]); return y == null ? null : `${xOf(i).toFixed(1)},${y.toFixed(1)}`; }).filter(Boolean);
      if (!pts.length) return '';
      // break into segments at nulls
      const segs = []; let seg = [];
      trend.forEach((d, i) => {
        const y = yOf(d[key]);
        if (y == null) { if (seg.length) { segs.push(seg); seg = []; } }
        else seg.push(`${xOf(i).toFixed(1)},${y.toFixed(1)}`);
      });
      if (seg.length) segs.push(seg);
      return segs.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`).join('');
    };
    // Zepbound marker
    const zbIdx = trend.findIndex(d => d.day >= zepboundStart);
    const zbLine = zbIdx >= 0 ? `
      <line x1="${xOf(zbIdx).toFixed(1)}" y1="${PAD.t}" x2="${xOf(zbIdx).toFixed(1)}" y2="${PAD.t + cH}" stroke="${GOLD}" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/>
      <text x="${(xOf(zbIdx)+3).toFixed(1)}" y="${(PAD.t+7).toFixed(1)}" font-size="7" fill="${GOLD}" opacity="0.9">Zepbound</text>
    ` : '';
    // Month labels on x-axis
    const monthLabels = [];
    trend.forEach((d, i) => {
      if (!d.day) return;
      const dt = new Date(d.day + 'T12:00:00');
      if (dt.getDate() === 1 || i === 0) {
        monthLabels.push(`<text x="${xOf(i).toFixed(1)}" y="${H - 2}" font-size="7" fill="var(--text-tertiary)" text-anchor="middle">${dt.toLocaleDateString('en-US',{month:'short'})}</text>`);
      }
    });
    // Y gridlines at 70 and 85
    const grid = [70, 85].map(v => {
      const y = yOf(v).toFixed(1);
      return `<line x1="${PAD.l}" y1="${y}" x2="${PAD.l + cW}" y2="${y}" stroke="var(--separator)" stroke-width="0.5"/>
              <text x="${PAD.l - 3}" y="${(parseFloat(y)+3).toFixed(1)}" font-size="7" fill="var(--text-tertiary)" text-anchor="end">${v}</text>`;
    }).join('');
    return `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--separator)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-tertiary);font-weight:700">120-Day Trend</div>
        <div style="display:flex;gap:10px">
          <span style="font-size:9px;color:#AF52DE">● Sleep</span>
          <span style="font-size:9px;color:var(--color-green)">● Readiness</span>
          <span style="font-size:9px;color:var(--accent)">● Activity</span>
        </div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;overflow:visible">
        ${grid}
        ${zbLine}
        ${line('sleep',     '#AF52DE')}
        ${line('readiness', 'var(--color-green)')}
        ${line('activity',  'var(--accent)')}
        ${monthLabels.join('')}
      </svg>
    </div>`;
  })();

  // Workouts list
  const workoutList = workouts.length ? `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--separator)">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-tertiary);font-weight:700;margin-bottom:8px">Recent Workouts</div>
      ${workouts.slice(0,5).map(w => {
        const name = (w.activity||'').replace(/([A-Z])/g,' $1').replace(/_/g,' ').trim();
        const nameCapd = name.charAt(0).toUpperCase() + name.slice(1);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--separator)">
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--text-primary)">${nameCapd}</div>
            <div style="font-size:10px;color:var(--text-tertiary)">${w.day || ''}</div>
          </div>
          <div style="text-align:right;font-size:11px;color:var(--text-secondary)">
            ${w.duration_min ? `${w.duration_min} min` : ''}
            ${w.calories ? ` · ${w.calories} kcal` : ''}
            ${w.distance_km > 0.1 ? ` · ${w.distance_km} km` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  return `
    <div class="txm-card txm-oura-card">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Body Stats
          <span style="font-size:10px;color:var(--text-tertiary);font-weight:400;text-transform:none;letter-spacing:0;margin-left:6px">${o.date || ''}</span>
        </h2>
        <div style="display:flex;align-items:center;gap:8px">
          ${aiBtn('sleep')}
          <button data-txm="oura-sync" title="Sync now" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:14px;padding:4px;line-height:1;transition:color 0.15s" id="txm-oura-sync-btn">↻</button>
        </div>
      </div>

      <!-- 3 top scores — tap to expand breakdown -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
        <div class="txm-oura-score-box${_ouraSection==='sleep'?' active':''}" data-txm="oura-section" data-section="sleep">
          <div class="txm-oura-score-num" style="color:${scoreColor(sleepScore)}">${sleepScore ?? '—'}</div>
          <div class="txm-oura-score-label">😴 Sleep</div>
        </div>
        <div class="txm-oura-score-box${_ouraSection==='readiness'?' active':''}" data-txm="oura-section" data-section="readiness">
          <div class="txm-oura-score-num" style="color:${scoreColor(readyScore)}">${readyScore ?? '—'}</div>
          <div class="txm-oura-score-label">⚡ Readiness</div>
        </div>
        <div class="txm-oura-score-box${_ouraSection==='activity'?' active':''}" data-txm="oura-section" data-section="activity">
          <div class="txm-oura-score-num" style="color:${scoreColor(actScore)}">${actScore ?? '—'}</div>
          <div class="txm-oura-score-label">🏃 Activity</div>
          ${(() => { const tod = new Date().toISOString().slice(0,10); const yes = new Date(Date.now()-86400000).toISOString().slice(0,10); return o.date === tod ? `<div style="font-size:9px;color:var(--color-green);font-weight:600;margin-top:2px">live today</div>` : o.date === yes ? `<div style="font-size:9px;color:${GOLD};font-weight:600;margin-top:2px">yesterday</div>` : o.date ? `<div style="font-size:9px;color:var(--text-tertiary);margin-top:2px">${o.date}</div>` : ''; })()}
        </div>
      </div>

      <!-- Key vitals row -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
        ${miniStatBox('💓', hrv + ' ms', 'HRV', 'var(--accent)')}
        ${miniStatBox('❤️', restHR + ' bpm', 'Resting HR', 'var(--color-red)')}
        ${spo2 ? miniStatBox('🩸', spo2, 'SpO2', (o.spo2_avg||0) >= 96 ? 'var(--color-green)' : GOLD) : miniStatBox('🩸','—','SpO2','var(--text-tertiary)')}
        ${tempDev ? miniStatBox('🌡️', tempDev, 'Temp Dev', Math.abs(o.temperature_deviation||0) < 0.5 ? 'var(--color-green)' : 'var(--color-red)') : miniStatBox('🌡️','—','Temp Dev','var(--text-tertiary)')}
      </div>

      <!-- Activity row — prefer Apple Health live data when Oura is from yesterday -->
      ${(() => {
        const h = _health;
        const ouraIsYesterday = o.activity_is_live === false;
        // Use Apple Health's today data when Oura hasn't synced today yet
        const liveSteps    = (ouraIsYesterday && h?.steps_today   != null) ? h.steps_today    : o.steps;
        const liveCal      = (ouraIsYesterday && h?.calories_active_today != null) ? h.calories_active_today : (o.active_calories ?? null);
        const liveExMins   = (ouraIsYesterday && h?.exercise_minutes_today != null) ? h.exercise_minutes_today : null;
        const usingAH      = ouraIsYesterday && h?.steps_today != null;
        const liveStepCol  = (liveSteps||0) >= 10000 ? 'var(--color-green)' : (liveSteps||0) >= 6000 ? GOLD : 'var(--color-red)';
        const sourceLabel  = usingAH
          ? `<span style="color:var(--color-green);font-weight:700">Apple Health · live</span>`
          : ouraIsYesterday ? `<span style="color:var(--color-orange)">Oura · yesterday</span>` : '';
        return `
        <div style="padding:10px 12px;background:var(--bg-surface-2);border-radius:10px;margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div>
              <div style="font-size:22px;font-weight:800;color:${liveStepCol};font-family:var(--font-sans);line-height:1">${liveSteps != null ? liveSteps.toLocaleString() : '—'}</div>
              <div style="font-size:9px;text-transform:uppercase;color:var(--text-tertiary);letter-spacing:.5px;margin-top:2px">Steps · Goal 10k${sourceLabel ? ' · ' + sourceLabel : ''}</div>
            </div>
            <div style="text-align:right">
              ${liveCal    ? `<div style="font-size:13px;font-weight:700;color:var(--color-orange)">🔥 ${liveCal} active</div>` : ''}
              ${liveExMins ? `<div style="font-size:11px;color:var(--text-secondary)">${liveExMins} min exercise</div>` : o.total_calories ? `<div style="font-size:11px;color:var(--text-secondary)">${o.total_calories} total kcal</div>` : ''}
              ${!usingAH && o.equivalent_walking_km ? `<div style="font-size:11px;color:var(--text-secondary)">${o.equivalent_walking_km} km equiv.</div>` : ''}
            </div>
          </div>
          ${!usingAH ? `
          <div style="display:flex;gap:12px;font-size:11px;color:var(--text-secondary)">
            ${o.high_activity_min   != null ? `<span>🔴 ${o.high_activity_min}m high</span>` : ''}
            ${o.medium_activity_min != null ? `<span>🟡 ${o.medium_activity_min}m med</span>` : ''}
            ${o.low_activity_min    != null ? `<span>🟢 ${o.low_activity_min}m low</span>` : ''}
            ${o.sedentary_min       != null ? `<span>⚪ ${o.sedentary_min}m sedentary</span>` : ''}
          </div>` : h?.stand_hours_today != null ? `
          <div style="display:flex;gap:12px;font-size:11px;color:var(--text-secondary)">
            <span>🧍 ${h.stand_hours_today} stand hrs</span>
            ${h.exercise_minutes_today != null ? `<span>🏃 ${h.exercise_minutes_today}m exercise</span>` : ''}
          </div>` : ''}
        </div>`;
      })()}

      <!-- Sleep breakdown — shown when Sleep card is tapped -->
      ${_ouraSection === 'sleep' ? `
        <div style="padding-top:12px;border-top:1px solid var(--separator);margin-top:4px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
            ${miniStatBox('🌙', secToHM(o.total_sleep_sec), 'Total', 'var(--text-primary)')}
            ${miniStatBox('🔵', secToHM(o.deep_sleep_sec),  'Deep',  '#6B8CFF')}
            ${miniStatBox('🟣', secToHM(o.rem_sleep_sec),   'REM',   '#AF52DE')}
            ${miniStatBox('⬜', secToHM(o.light_sleep_sec), 'Light', 'var(--text-secondary)')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
            ${o.sleep_efficiency != null ? miniStatBox('📊', o.sleep_efficiency+'%', 'Efficiency', o.sleep_efficiency>=85?'var(--color-green)':GOLD) : ''}
            ${o.breath_avg       != null ? miniStatBox('💨', o.breath_avg+'/m', 'Breath', 'var(--text-secondary)') : ''}
            ${o.avg_hr_sleep     != null ? miniStatBox('💗', o.avg_hr_sleep+' bpm', 'Avg HR', 'var(--text-secondary)') : ''}
            ${bdi                != null ? miniStatBox('😤', bdi, 'Disturbance', bdiColor) : ''}
          </div>
          ${o.bedtime_start ? `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:10px">🛏️ ${fmtTime(o.bedtime_start)} → ${fmtTime(o.bedtime_end)}${o.restless_periods ? ` · ${o.restless_periods} restless periods` : ''}</div>` : ''}
          ${Object.keys(sleepContrib).length ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-tertiary);font-weight:700;margin-bottom:4px">Sleep Contributors</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
              ${contribBar('Deep Sleep',  sleepContrib.deep_sleep)}
              ${contribBar('REM Sleep',   sleepContrib.rem_sleep)}
              ${contribBar('Efficiency',  sleepContrib.efficiency)}
              ${contribBar('Restfulness', sleepContrib.restfulness)}
              ${contribBar('Timing',      sleepContrib.timing)}
              ${contribBar('Total Sleep', sleepContrib.total_sleep)}
              ${contribBar('Latency',     sleepContrib.latency)}
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Readiness breakdown — shown when Readiness card is tapped -->
      ${_ouraSection === 'readiness' ? `
        <div style="padding-top:12px;border-top:1px solid var(--separator);margin-top:4px">
          ${Object.keys(readyContrib).length ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-tertiary);font-weight:700;margin-bottom:4px">Readiness Contributors</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
              ${contribBar('HRV Balance',        readyContrib.hrv_balance)}
              ${contribBar('Resting HR',         readyContrib.resting_heart_rate)}
              ${contribBar('Body Temp',          readyContrib.body_temperature)}
              ${contribBar('Previous Night',     readyContrib.previous_night)}
              ${contribBar('Sleep Balance',      readyContrib.sleep_balance)}
              ${contribBar('Activity Balance',   readyContrib.activity_balance)}
              ${contribBar('Recovery Index',     readyContrib.recovery_index)}
              ${contribBar('Sleep Regularity',   readyContrib.sleep_regularity)}
            </div>
          ` : '<div style="font-size:12px;color:var(--text-tertiary)">No readiness data available.</div>'}
          ${stressLabel ? `
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--separator)">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-tertiary);font-weight:700;margin-bottom:8px">Stress & Recovery</div>
              <div style="display:flex;align-items:center;gap:12px">
                <div style="font-size:14px;font-weight:700;color:${stressColor}">${stressLabel}</div>
                <div style="font-size:11px;color:var(--text-secondary)">
                  ${o.stress_high_min != null ? `😤 ${o.stress_high_min}m stress` : ''}
                  ${o.recovery_high_min != null ? ` · ✨ ${o.recovery_high_min}m recovery` : ''}
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Activity breakdown — shown when Activity card is tapped -->
      ${_ouraSection === 'activity' ? (() => {
        const todayStr = new Date().toISOString().slice(0,10);
        const yesterStr = new Date(Date.now()-86400000).toISOString().slice(0,10);
        const allW = Array.isArray(o.workouts) ? o.workouts : [];
        const todayW  = allW.filter(w => w.day === todayStr);
        const yesterW = allW.filter(w => w.day === yesterStr);
        const mkRow = (w, src) => workoutRow({ activity: fmtWorkoutName(w.activity), date: w.day,
          duration_min: w.duration_min, calories: w.calories||null,
          distance_km: (w.distance_km||0) > 0.1 ? w.distance_km : null, source: src || w.source || 'Oura' }, true);
        // Apple Health workouts for today (from bridge or shortcut) when Oura has none
        const ahToday = [
          ...(Array.isArray(_health?.workouts) ? _health.workouts : []),
          ..._shortcutWorkouts,
        ].filter(w => w.date === todayStr);
        const showAhToday = todayW.length === 0 && ahToday.length > 0;
        return `
        <div style="padding-top:12px;border-top:1px solid var(--separator);margin-top:4px">
          ${todayW.length ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--color-green);font-weight:700;margin-bottom:2px">Today's Workouts · Oura</div>
            ${todayW.map(w => mkRow(w, 'Oura')).join('')}
            <div style="margin-top:10px"></div>
          ` : ''}
          ${showAhToday ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--color-green);font-weight:700;margin-bottom:2px">Today's Workouts · Apple Health</div>
            ${ahToday.map(w => mkRow(w, 'Apple Health')).join('')}
            <div style="margin-top:10px"></div>
          ` : ''}
          ${yesterW.length ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:${GOLD};font-weight:700;margin-bottom:2px">Yesterday's Workouts</div>
            ${yesterW.map(w => mkRow(w, 'Oura')).join('')}
            <div style="margin-top:10px"></div>
          ` : ''}
          ${!todayW.length && !showAhToday && !yesterW.length ? `
            <div style="font-size:12px;color:var(--text-tertiary);padding:6px 0">No workouts logged in the last 2 days.</div>
          ` : ''}
          ${Object.keys(actContrib).length ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-tertiary);font-weight:700;margin-bottom:4px">Activity Contributors</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
              ${contribBar('Stay Active',        actContrib.stay_active)}
              ${contribBar('Move Every Hour',    actContrib.move_every_hour)}
              ${contribBar('Training Volume',    actContrib.training_volume)}
              ${contribBar('Training Frequency', actContrib.training_frequency)}
              ${contribBar('Meet Daily Targets', actContrib.meet_daily_targets)}
              ${contribBar('Recovery Time',      actContrib.recovery_time)}
            </div>
          ` : '<div style="font-size:12px;color:var(--text-tertiary)">No activity data available.</div>'}
        </div>`;
      })() : ''}

      <!-- AI Insight — always visible -->
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--separator)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-tertiary);font-weight:700">✦ AI Insight</div>
          ${!ins.text && !ins.loading ? `<button data-txm="sleep-insight" style="padding:4px 12px;border-radius:20px;border:none;background:var(--accent);color:#000;font-size:11px;font-weight:700;cursor:pointer">Analyze</button>` : ''}
          ${ins.text ? `<button data-txm="sleep-insight" style="padding:4px 10px;border-radius:20px;border:1px solid var(--separator);background:none;color:var(--text-tertiary);font-size:11px;cursor:pointer">↺</button>` : ''}
        </div>
        ${ins.loading ? `
          <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary);font-style:italic">
            <div style="width:12px;height:12px;border:2px solid var(--separator);border-top-color:var(--accent);border-radius:50%;animation:txm-spin 0.7s linear infinite"></div>
            Analyzing…
          </div>` :
        ins.error ? `<div style="font-size:12px;color:var(--color-red)">${ins.error}</div>` :
        ins.text  ? `<div style="font-size:13px;color:var(--text-primary);line-height:1.6">${ins.text}</div>` :
        `<div style="font-size:12px;color:var(--text-tertiary)">Tap a score card above to see its breakdown.</div>`}
      </div>
    </div>`;
}

// ── Lifecycle ──────────────────────────────────────────────────
export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  injectStyles();
  txLoad();   // localStorage first (instant)
  render();
  txLoadFirestore().then(loaded => {
    if (loaded) {
      if (_renpho?.ok && _renpho.weight_lbs) S.weight = _renpho.weight_lbs;
      render();
    }
  });
  fetchOura();              // async — re-renders when data arrives
  startOuraPolling();       // poll Firestore every 5 min for cross-device sync
  fetchAppleHealth();       // Apple Health via bridge or Firestore
  fetchRenpho();            // Full RENPHO body-comp via bridge
  fetchShortcutWorkouts();  // Apple Health workouts via iOS Shortcut → iCloud Drive
  _interval = setInterval(() => {
    const key = todayKey();
    if (key !== window._txmDateKey) {
      window._txmDateKey = key;
      S.checks = {}; S.protein = 0;
      // Reset recovery on Sunday (new week)
      if (new Date().getDay() === 0) S.recovery = { sauna: 0, ice: 0 };
      txLoad();
      fetchOura(); // refresh sleep data each new day
    }
    render();
  }, 60000);
  window._txmDateKey = todayKey();
}

export function cleanup() {
  clearInterval(_interval);
  _interval = null;
  _localDirty = false;
  stopOuraPolling();
  _container = null;
  _ctx = null;
  _oura = null;
  _health = null;
  _renpho = null;
  _ouraInsight = { text: null, loading: false, error: null };
  Object.keys(_insights).forEach(k => { _insights[k] = { text: null, loading: false, error: null }; });
}
