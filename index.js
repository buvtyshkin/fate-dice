// Fate Dice: an honest outside roll the player arms by hand for one turn. The number goes
// into the player's message as a mark, so it is saved with the chat and survives swipes.
// The rule that tells the model how to read it is injected at depth 0, only while the
// player's last turn carries a mark, so the cached prefix never changes.

import { appendNote, buildNote, findFate, lastUserMessage, parseFormula, renderRule, roll } from './fate-core.js';

const MODULE = 'fate_dice';
const LOG = '[Fate Dice]';
const PROMPT_KEY = 'fate_dice';
const BUTTON_ID = 'fate_dice_button';
const IN_CHAT = 1;                         // extension_prompt_types.IN_CHAT
const ROLES = { system: 0, user: 1 };      // extension_prompt_roles
const SAMPLE = { value: 12, max: 18 };

const DEFAULT_RULE = '🎲 В последнем ходе {{user}} стоит пометка броска судьбы — честное число, выпавшее до тебя (3d6, от 3 до 18). Ход {{user}} — заявка; бросок решает, как она легла. Это не умение — умение задаёт характер, — а удача: обстоятельства, люди, момент. 3–5 — тяжело, 6–8 — плохо, 9–12 — обычная жизнь с шероховатостью, 13–15 — хорошо, 16–18 — редкая удача. Бросок окрашивает весь ответ: исход поступков, как приняли слова, настроение людей, ход событий. Форму выбирай свободно, силу не смягчай и не раздувай. Прошлые броски уже отыграны. Пометку в тексте не упоминай.';

const DEFAULTS = {
    enabled: true,
    armed: false,
    sticky: false,             // false: the button disarms after one message
    formula: '3d6',
    template: '[🎲 Судьба: {{fate}}/{{fate_max}}]',
    newline: true,             // the mark starts on its own line
    rule: DEFAULT_RULE,
    role: 'system',
};

let settings = null;

const ctx = () => SillyTavern.getContext();

// ---------- roll ----------

function makeNote() {
    const formula = parseFormula(settings.formula) || parseFormula(DEFAULTS.formula);
    return buildNote(settings.template, roll(formula));
}

// ---------- rule injection ----------

function setRule(text) {
    const role = ROLES[settings.role] ?? ROLES.system;
    ctx().setExtensionPrompt(PROMPT_KEY, text, IN_CHAT, 0, false, role);
}

/** Rule on if the player's last turn has a mark, off otherwise. */
function syncRule() {
    const c = ctx();
    const fate = settings.enabled ? findFate(lastUserMessage(c.chat)?.mes) : null;
    setRule(fate ? c.substituteParams(renderRule(settings.rule, fate)) : '');
    return fate;
}

/**
 * Runs for every generation, after any edit the player made to the mark.
 * Impersonation and quiet requests (summaries and the like) are not a reply to the turn.
 */
function onGeneration(type) {
    if (type === 'quiet' || type === 'impersonate') {
        setRule('');
        return;
    }
    const fate = syncRule();
    if (fate) console.debug(`${LOG} ${type}: правило в промпте, бросок ${fate.value}/${fate.max}`);
}

/**
 * ST saves the message, emits this, and only then renders it and builds the prompt, so an
 * edit here reaches the model and the screen whichever way the message was sent.
 * On a normal send this is also the first moment the new turn exists for syncRule.
 */
async function onMessageSent(id) {
    const c = ctx();
    const mes = c.chat?.[Number(id)];
    // `/send at=` puts a message into the past: leave that one alone and stay armed.
    if (settings.enabled && settings.armed && mes?.is_user && Number(id) === c.chat.length - 1) {
        // A mark already there came from /fate or by hand: it counts as this turn's roll.
        if (!findFate(mes.mes)) {
            mes.mes = appendNote(mes.mes, makeNote(), settings.newline);
            if (mes.extra?.token_count != null) mes.extra.token_count = await c.getTokenCountAsync(mes.mes, 0);
            await c.saveChat();
        }
        if (!settings.sticky) setArmed(false);
    }
    syncRule();
}

// ---------- button ----------

function setArmed(on) {
    settings.armed = !!on;
    ctx().saveSettingsDebounced();
    drawButton();
}

function drawButton() {
    $(`#${BUTTON_ID}`)
        .toggleClass('fate-armed', settings.armed)
        .toggle(settings.enabled)
        .attr('aria-pressed', String(settings.armed))
        .attr('title', settings.armed
            ? `Бросок судьбы взведён: ${settings.formula}${settings.sticky ? ', для каждого сообщения' : ', на следующее сообщение'}`
            : 'Бросок судьбы: взвести');
}

function addButton() {
    $(`#${BUTTON_ID}`).remove();
    const $b = $(`<div id="${BUTTON_ID}" class="fa-solid fa-dice interactable" tabindex="0" role="button"></div>`);
    $b.on('click', () => setArmed(!settings.armed));
    $('#leftSendForm').append($b);
    drawButton();
}

// ---------- /fate ----------

function onFateCommand() {
    if (!settings.enabled) {
        toastr.warning('Fate Dice выключен в настройках.');
        return '';
    }
    const ta = document.querySelector('#send_textarea');
    if (findFate(ta.value)) return '';
    const note = makeNote();
    ta.value = appendNote(ta.value, note, settings.newline);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return note;
}

function registerCommand() {
    const c = ctx();
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'fate',
        callback: onFateCommand,
        returns: 'текст добавленной пометки, пусто, если пометка в поле уже есть',
        helpString: 'Бросает кубик Fate Dice и дописывает пометку к тексту в поле ввода.',
    }));
}

// ---------- settings ----------

function loadSettings() {
    const root = ctx().extensionSettings;
    root[MODULE] = Object.assign({}, DEFAULTS, root[MODULE]);
    settings = root[MODULE];
}

function drawHints() {
    const formulaOk = !!parseFormula(settings.formula);
    $('#fate_formula_hint').toggle(!formulaOk);
    // A template the regex cannot read would roll, but the rule would never turn on.
    const templateOk = !!findFate(buildNote(settings.template, SAMPLE));
    $('#fate_template_hint').toggle(!templateOk);
}

function addSettingsPanel() {
    const html = `
    <div class="fate-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🎲 Fate Dice</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="fate_enabled"> Включено</label>
                <label class="checkbox_label"><input type="checkbox" id="fate_sticky"> Залипающая кнопка: остаётся взведённой после отправки</label>
                <label for="fate_formula">Кубик (NdM)</label>
                <input type="text" id="fate_formula" class="text_pole" spellcheck="false">
                <small id="fate_formula_hint" class="fate-hint">Нужен вид NdM, например 3d6. Пока формула неверна, бросается ${DEFAULTS.formula}.</small>
                <label for="fate_template">Шаблон пометки: <code>{{fate}}</code> — число, <code>{{fate_max}}</code> — максимум</label>
                <input type="text" id="fate_template" class="text_pole" spellcheck="false">
                <small id="fate_template_hint" class="fate-hint">Правило узнаёт только пометку вида <code>[🎲 … {{fate}}/{{fate_max}}]</code>. С таким шаблоном оно не включится.</small>
                <label class="checkbox_label"><input type="checkbox" id="fate_newline"> Пометка с новой строки</label>
                <label for="fate_rule">Правило для модели: те же <code>{{fate}}</code> и <code>{{fate_max}}</code>, а также <code>{{user}}</code></label>
                <textarea id="fate_rule" class="text_pole" rows="10"></textarea>
                <small>Шкалу в тексте при смене кубика правьте сами.</small>
                <label for="fate_role">Роль правила</label>
                <select id="fate_role" class="text_pole">
                    <option value="system">system</option>
                    <option value="user">user</option>
                </select>
            </div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    const changed = () => {
        ctx().saveSettingsDebounced();
        drawButton();
        drawHints();
        syncRule();
    };
    const bindCheck = (id, key) => $(id).prop('checked', settings[key]).on('input', function () {
        settings[key] = this.checked;
        changed();
    });
    const bindText = (id, key) => $(id).val(settings[key]).on('input', function () {
        settings[key] = String($(this).val());
        changed();
    });
    bindCheck('#fate_enabled', 'enabled');
    bindCheck('#fate_sticky', 'sticky');
    bindCheck('#fate_newline', 'newline');
    bindText('#fate_formula', 'formula');
    bindText('#fate_template', 'template');
    bindText('#fate_rule', 'rule');
    bindText('#fate_role', 'role');
    drawHints();
}

// ---------- start ----------

jQuery(() => {
    loadSettings();
    addSettingsPanel();
    addButton();
    registerCommand();

    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, onGeneration);
    eventSource.on(eventTypes.MESSAGE_SENT, onMessageSent);
    eventSource.on(eventTypes.CHAT_CHANGED, syncRule);
    console.log(`${LOG} загружен.`);
});
