/* =============================================================
   SCHEDULE  —  Fixed reference data (hard-coded by design).
   Change here only if the real timetable changes.
   The SAME definitions are mirrored inside the Apps Script
   backend (Code.gs) so the server can compute On-time/Late.
   ============================================================= */

const SUBJECTS = [
  "Biology",
  "Chemistry",
  "Physics",
  "Maths",
  "English",
  "Urdu",
  "Islamiat",
  "Tarjuma-tul-Quran",
  "Pakistan Study"
];

const ACTIVITY_TYPES = [
  "Read/Understood",
  "Memorized",
  "Practiced",
  "Written"
];

// Confidence is optional. Friendly three-level scale.
const CONFIDENCE_LEVELS = ["Easy", "Medium", "Hard"];

// Daily slots. start/end use 24-hour "HH:MM" for time-window math.
const SLOTS = [
  { id: "S1", label: "Session 1", time: "10:45 AM – 12:15 PM", start: "10:45", end: "12:15" },
  { id: "S2", label: "Session 2", time: "2:00 PM – 3:30 PM",   start: "14:00", end: "15:30" },
  { id: "S3", label: "Session 3", time: "5:30 PM – 6:30 PM",   start: "17:30", end: "18:30" }
];

// ±15 minute grace on each side of a slot window (for On-time check).
const ON_TIME_BUFFER_MIN = 15;

// Weekly rotation: which subject(s) belong to each slot on each day.
// Sunday  → null        (off day, no sessions)
// Saturday → "TEST_DAY" (dedicated test / exam day, no regular sessions)
//
// Pairings:
//   English + Tarjuma-tul-Quran  → always in the same slot
//   Urdu    + Islamiat            → always in the same slot
//   Pakistan Study                → 3 days, one dedicated full slot per day
const SCHEDULE = {
  Monday:    { S1: ["Maths"],     S2: ["Physics"],            S3: ["Pakistan Study"] },
  Tuesday:   { S1: ["Biology"],   S2: ["Urdu", "Islamiat"],   S3: ["English", "Tarjuma-tul-Quran"] },
  Wednesday: { S1: ["Chemistry"], S2: ["Maths"],              S3: ["Pakistan Study"] },
  Thursday:  { S1: ["Physics"],   S2: ["Urdu", "Islamiat"],   S3: ["English", "Tarjuma-tul-Quran"] },
  Friday:    { S1: ["Biology"],   S2: ["Chemistry"],          S3: ["Pakistan Study"] },
  Saturday:  "TEST_DAY",
  Sunday:    null
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Human-readable label stored in the sheet's "Time Slot" column.
function slotSheetLabel(slot) {
  return `${slot.label} (${slot.time})`;
}

// Look up a slot definition by its id ("S1" | "S2" | "S3").
function getSlotById(id) {
  return SLOTS.find(s => s.id === id) || null;
}
