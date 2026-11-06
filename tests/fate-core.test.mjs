import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, roll, buildNote, renderRule, findFate, appendNote, lastUserMessage } from '../fate-core.js';

const fixed = (...values) => {
    let i = 0;
    return (buf) => { buf[0] = values[i++]; };
};

test('parseFormula accepts NdM and refuses the rest', () => {
    assert.deepEqual(parseFormula('3d6'), { count: 3, sides: 6 });
    assert.deepEqual(parseFormula(' 2 D 20 '), { count: 2, sides: 20 });
    for (const bad of ['', 'd6', '3d', '3d6+1', '0d6', '3d1', '101d6', 'abc', null]) {
        assert.equal(parseFormula(bad), null, String(bad));
    }
});

test('roll stays in range and reports the maximum', () => {
    const f = parseFormula('3d6');
    for (let i = 0; i < 2000; i++) {
        const { value, max } = roll(f);
        assert.equal(max, 18);
        assert.ok(value >= 3 && value <= 18, String(value));
    }
});

test('roll uses every face of a die about equally', () => {
    const counts = new Array(7).fill(0);
    const f = { count: 1, sides: 6 };
    const n = 60000;
    for (let i = 0; i < n; i++) counts[roll(f).value]++;
    for (let face = 1; face <= 6; face++) {
        assert.ok(Math.abs(counts[face] - n / 6) < 600, `face ${face}: ${counts[face]}`);
    }
});

test('roll rejects raw values from the biased tail', () => {
    // 2^32 % 6 = 4, so the top four raw values must be thrown away.
    const top = 2 ** 32 - 1;
    assert.deepEqual(roll({ count: 1, sides: 6 }, fixed(top, 7)), { value: 2, max: 6 });
    assert.deepEqual(roll({ count: 2, sides: 6 }, fixed(0, 5)), { value: 7, max: 12 });
});

test('buildNote fills both macros', () => {
    assert.equal(buildNote('[🎲 Судьба: {{fate}}/{{fate_max}}]', { value: 12, max: 18 }), '[🎲 Судьба: 12/18]');
});

test('renderRule fills every occurrence and leaves other macros alone', () => {
    assert.equal(renderRule('{{user}}: {{fate}} из {{FATE_MAX}}, снова {{fate}}', { value: 1, max: 18 }), '{{user}}: 1 из 18, снова 1');
});

test('findFate reads a mark, edited or not', () => {
    assert.deepEqual(findFate('Иду.\n[🎲 Судьба: 12/18]'), { value: 12, max: 18 });
    assert.deepEqual(findFate('[🎲 1/18]'), { value: 1, max: 18 });
    assert.deepEqual(findFate('[🎲 Судьба: 7 / 20]'), { value: 7, max: 20 });
    assert.deepEqual(findFate('[🎲 d100: 99/100]'), { value: 99, max: 100 });
});

test('findFate ignores text that only looks like a mark', () => {
    for (const text of ['', null, 'Иду 12/18', '[Судьба: 12/18]', '[🎲 Судьба: 12]', '[🎲 Судьба]', '🎲 12/18']) {
        assert.equal(findFate(text), null, String(text));
    }
});

test('findFate takes the last mark and gives the same answer twice', () => {
    const text = '[🎲 3/18] потом [🎲 16/18]';
    assert.deepEqual(findFate(text), { value: 16, max: 18 });
    assert.deepEqual(findFate(text), { value: 16, max: 18 });
});

test('appendNote places the note', () => {
    assert.equal(appendNote('Иду.', '[n]'), 'Иду.\n[n]');
    assert.equal(appendNote('Иду.\n\n', '[n]'), 'Иду.\n[n]');
    assert.equal(appendNote('Иду.', '[n]', false), 'Иду. [n]');
    assert.equal(appendNote('', '[n]'), '[n]');
});

test('a note built from the default template is found again', () => {
    const note = buildNote('[🎲 Судьба: {{fate}}/{{fate_max}}]', { value: 9, max: 18 });
    assert.deepEqual(findFate(appendNote('Иду.', note)), { value: 9, max: 18 });
});

test('lastUserMessage skips the character and hidden messages', () => {
    const a = { is_user: true, is_system: false, mes: 'a' };
    const hidden = { is_user: true, is_system: true, mes: 'hidden' };
    const reply = { is_user: false, is_system: false, mes: 'reply' };
    assert.equal(lastUserMessage([a, hidden, reply]), a);
    assert.equal(lastUserMessage([reply]), null);
    assert.equal(lastUserMessage([]), null);
    assert.equal(lastUserMessage(undefined), null);
});
