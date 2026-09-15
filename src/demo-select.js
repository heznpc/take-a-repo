/* Record native select changes inside the page video instead of OS UI. */

const { normalizeDelayMs } = require('./demo-time');

const DEFAULT_SELECT_OPEN_MS = 900;
const DEFAULT_SELECT_HOLD_MS = 700;
const DEFAULT_SELECT_MOVE_MS = 360;
const DEFAULT_SELECT_BEFORE_MS = 120;
const DEFAULT_SELECT_MAX_OPTIONS = 7;

function demoSelectInitScript() {
  const rootId = '__take-a-repo_demo_select__';
  const styleId = '__take-a-repo_demo_select_style__';

  function ensureStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${rootId} {
        position: fixed;
        z-index: 2147483646;
        box-sizing: border-box;
        min-width: 190px;
        max-width: min(320px, calc(100vw - 24px));
        padding: 4px;
        border: 1px solid rgba(15,23,42,.22);
        border-radius: 6px;
        background: #fff;
        color: #111827;
        box-shadow: 0 18px 42px rgba(15,23,42,.28);
        font: 600 15px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        letter-spacing: 0;
        pointer-events: none;
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity 120ms ease, transform 120ms ease;
      }
      #${rootId}[data-visible="true"] {
        opacity: 1;
        transform: translateY(0);
      }
      #${rootId} .take-a-repo-select-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 34px;
        padding: 7px 10px;
        border-radius: 4px;
        white-space: nowrap;
      }
      #${rootId} .take-a-repo-select-row[data-pending="true"] {
        background: #eff6ff;
        box-shadow: inset 3px 0 #2563eb;
        color: #1d4ed8;
      }
      #${rootId} .take-a-repo-select-row[data-selected="true"] {
        background: #2563eb;
        color: #fff;
      }
      #${rootId} .take-a-repo-select-marker {
        width: 8px;
        height: 8px;
        margin-left: 14px;
        border: 2px solid currentColor;
        border-radius: 999px;
        opacity: 0;
      }
      #${rootId} .take-a-repo-select-row[data-selected="true"] .take-a-repo-select-marker,
      #${rootId} .take-a-repo-select-row[data-pending="true"] .take-a-repo-select-marker {
        opacity: 1;
      }
      #${rootId} .take-a-repo-select-gap {
        height: 10px;
        color: #94a3b8;
        font: 700 12px/10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    if (!document.body) return null;
    ensureStyle();
    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement('div');
      root.id = rootId;
      root.className = 'notranslate';
      root.setAttribute('translate', 'no');
      root.setAttribute('role', 'listbox');
      document.body.appendChild(root);
    }
    return root;
  }

  function show(model) {
    const root = ensureRoot();
    if (!root) return;
    const estimatedHeight = (model.items.length * 34) + 8;
    const width = Math.min(Math.max(model.rect.width, 190), 320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(model.rect.left, window.innerWidth - width - 12));
    const below = model.rect.bottom + 6;
    const top = below + estimatedHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, model.rect.top - estimatedHeight - 6);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${width}px`;
    root.replaceChildren();
    for (const item of model.items) {
      if (item.gap) {
        const gap = document.createElement('div');
        gap.className = 'take-a-repo-select-gap';
        gap.textContent = '...';
        root.appendChild(gap);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'take-a-repo-select-row';
      row.dataset.value = item.value;
      row.dataset.selected = item.value === model.currentValue ? 'true' : 'false';
      row.dataset.pending = item.value === model.targetValue && item.value !== model.currentValue ? 'true' : 'false';
      const label = document.createElement('b');
      label.textContent = item.label;
      const marker = document.createElement('i');
      marker.className = 'take-a-repo-select-marker';
      row.append(label, marker);
      root.appendChild(row);
    }
    root.dataset.visible = 'true';
  }

  function commit(value) {
    const root = ensureRoot();
    if (!root) return;
    for (const row of root.querySelectorAll('.take-a-repo-select-row')) {
      row.dataset.selected = row.dataset.value === value ? 'true' : 'false';
      row.dataset.pending = 'false';
    }
  }

  function hide() {
    const root = ensureRoot();
    if (!root) return;
    root.dataset.visible = 'false';
    window.setTimeout(() => {
      if (root.dataset.visible !== 'true') root.replaceChildren();
    }, 180);
  }

  window.__takeARepoDemoSelect = { show, commit, hide };
}

async function installDemoSelectOverlay(context) {
  await context.addInitScript(demoSelectInitScript);
}

async function ensureDemoSelectOverlay(page) {
  await page.evaluate(demoSelectInitScript);
}

function selectLocator(page, target) {
  const locator = typeof target === 'string' && typeof page.locator === 'function'
    ? page.locator(target)
    : target;
  if (!locator || typeof locator.evaluate !== 'function'
    || typeof locator.focus !== 'function' || typeof locator.selectOption !== 'function') {
    throw new Error('take-a-repo: demo.select target must be a selector string or Locator for a select element');
  }
  return locator;
}

async function readDemoSelectModel(locator, value, maxOptions) {
  return locator.evaluate((element, input) => {
    if (!element || element.tagName !== 'SELECT') {
      throw new Error('take-a-repo: demo.select target must resolve to a select element');
    }
    const options = Array.from(element.options).map((option, index) => ({
      index,
      value: option.value,
      label: option.label || option.textContent || option.value,
    }));
    const targetIndex = options.findIndex((option) => option.value === input.value);
    if (targetIndex < 0) {
      throw new Error(`take-a-repo: demo.select option "${input.value}" was not found`);
    }

    const selectedIndex = element.selectedIndex;
    const indexes = new Set();
    const add = (index) => {
      if (indexes.size >= input.maxOptions) return;
      if (index >= 0 && index < options.length) indexes.add(index);
    };
    add(selectedIndex);
    add(targetIndex);
    for (let radius = 1; indexes.size < input.maxOptions && radius < options.length; radius++) {
      add(targetIndex - radius);
      add(targetIndex + radius);
      add(selectedIndex - radius);
      add(selectedIndex + radius);
    }

    const items = [];
    let previous = null;
    for (const index of [...indexes].sort((a, b) => a - b)) {
      if (previous != null && index > previous + 1) items.push({ gap: true });
      items.push(options[index]);
      previous = index;
    }
    const rect = element.getBoundingClientRect();
    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      currentValue: element.value,
      targetValue: input.value,
      items,
    };
  }, { value, maxOptions });
}

async function showDemoSelect(page, model) {
  await ensureDemoSelectOverlay(page);
  await page.evaluate(({ selectModel }) => {
    window.__takeARepoDemoSelect.show(selectModel);
  }, { selectModel: model });
}

async function commitDemoSelect(page, value) {
  await page.evaluate(({ selectedValue }) => {
    if (window.__takeARepoDemoSelect) window.__takeARepoDemoSelect.commit(selectedValue);
  }, { selectedValue: value });
}

async function hideDemoSelect(page) {
  await page.evaluate(() => {
    if (window.__takeARepoDemoSelect) window.__takeARepoDemoSelect.hide();
  });
}

async function performDemoSelect({ page, target, value, options = {}, targetCenter, movePointer, pulsePointer }) {
  if (typeof value !== 'string' || !value) {
    throw new Error('take-a-repo: demo.select value must be a non-empty option value string');
  }
  const {
    openMs = DEFAULT_SELECT_OPEN_MS,
    holdMs = DEFAULT_SELECT_HOLD_MS,
    moveMs = DEFAULT_SELECT_MOVE_MS,
    beforeMs = DEFAULT_SELECT_BEFORE_MS,
    maxOptions = DEFAULT_SELECT_MAX_OPTIONS,
    highlight = true,
  } = options;
  if (!Number.isInteger(maxOptions) || maxOptions < 2 || maxOptions > 9) {
    throw new Error('take-a-repo: demo.select maxOptions must be an integer between 2 and 9');
  }
  const normalizedOpenMs = normalizeDelayMs(openMs, 'select openMs');
  const normalizedHoldMs = normalizeDelayMs(holdMs, 'select holdMs');
  const normalizedMoveMs = normalizeDelayMs(moveMs, 'select moveMs');
  const normalizedBeforeMs = normalizeDelayMs(beforeMs, 'select beforeMs');
  const locator = selectLocator(page, target);
  const model = await readDemoSelectModel(locator, value, maxOptions);
  const point = highlight ? await targetCenter(page, locator) : null;
  if (point) {
    await movePointer(page, point, { durationMs: normalizedMoveMs });
    if (normalizedMoveMs + normalizedBeforeMs > 0) {
      await page.waitForTimeout(normalizedMoveMs + normalizedBeforeMs);
    }
  }
  await locator.focus();
  await showDemoSelect(page, model);
  try {
    if (normalizedOpenMs > 0) await page.waitForTimeout(normalizedOpenMs);
    const result = await locator.selectOption(value);
    if (point) await pulsePointer(page);
    await commitDemoSelect(page, value);
    if (normalizedHoldMs > 0) await page.waitForTimeout(normalizedHoldMs);
    return result;
  } finally {
    await hideDemoSelect(page).catch(() => {});
  }
}

module.exports = {
  demoSelectInitScript,
  hideDemoSelect,
  installDemoSelectOverlay,
  performDemoSelect,
};
