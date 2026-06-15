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
  "Tarjuma-tul-Quran"
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
// Sunday is OFF (null) — no slots, no submissions expected.
const SCHEDULE = {
  Monday:    { S1: ["Maths", "Physics"],   S2: ["Biology"], S3: ["Urdu", "Islamiat"] },
  Tuesday:   { S1: ["Maths", "Chemistry"], S2: ["English"], S3: ["Tarjuma-tul-Quran", "Urdu"] },
  Wednesday: { S1: ["Maths", "Physics"],   S2: ["Biology"], S3: ["Islamiat", "Tarjuma-tul-Quran"] },
  Thursday:  { S1: ["Maths", "Chemistry"], S2: ["English"], S3: ["Urdu", "Islamiat"] },
  Friday:    { S1: ["Maths", "Physics"],   S2: ["Biology"], S3: ["Tarjuma-tul-Quran", "Urdu"] },
  Saturday:  { S1: ["Maths", "Chemistry"], S2: ["English"], S3: ["Islamiat", "Tarjuma-tul-Quran"] },
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
