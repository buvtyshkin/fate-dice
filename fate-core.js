// Fate Dice: pure logic, no SillyTavern or DOM. Covered by tests/fate-core.test.mjs.

// Any numbers pass, so a hand-edited mark keeps working.
const FATE_RE = /\[🎲[^\]]*?(\d+)\s*\/\s*(\d+)\]/g;

const MAX_DICE = 100;
const MAX_SIDES = 1000000;

/** "3d6" → { count: 3, sides: 6 }; null if it is not a sensible NdM. */
export function parseFormula(text) {
    const m = /^\s*(\d+)\s*d\s*(\d+)\s*$/i.exec(String(text ?? ''));
    if (!m) return null;
    const count = Number(m[1]);
    const sides = Number(m[2]);
    if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) return null;
    return { count, sides };
}

/** Uniform integer in 1..sides. Rejection sampling: a plain modulo would favour low faces. */
function rollDie(sides, fill) {
    const range = 2 ** 32;
    const limit = range - (range % sides);
    const buf = new Uint32Array(1);
    do {
        fill(buf);
    } while (buf[0] >= limit);
    return (buf[0] % sides) + 1;
}

/** Rolls a parsed formula. `fill` is crypto.getRandomValues unless a test passes its own. */
export function roll({ count, sides }, fill = (buf) => crypto.getRandomValues(buf)) {
    let value = 0;
    for (let i = 0; i < count; i++) value += rollDie(sides, fill);
    return { value, max: count * sides };
}

function fillMacros(text, { value, max }) {
    return String(text ?? '')
        .replace(/\{\{fate_max\}\}/gi, String(max))
        .replace(/\{\{fate\}\}/gi, String(value));
}

export const buildNote = fillMacros;
export const renderRule = fillMacros;

/** The last fate mark in a text as { value, max }, or null. */
export function findFate(text) {
    let last = null;
    for (const m of String(text ?? '').matchAll(FATE_RE)) last = m;
    return last ? { value: Number(last[1]), max: Number(last[2]) } : null;
}

export function appendNote(text, note, newline = true) {
    const base = String(text ?? '').replace(/\s+$/, '');
    if (!base) return note;
    return base + (newline ? '\n' : ' ') + note;
}

/** The player's last turn the model can see: hidden messages are flagged is_system. */
export function lastUserMessage(chat) {
    for (let i = (chat?.length ?? 0) - 1; i >= 0; i--) {
        if (chat[i].is_user && !chat[i].is_system) return chat[i];
    }
    return null;
}
