// Audience BOT persona page (docs/design.md #4): edits the Agent.md of the douyin-live connector through
// MAESTROSDK.connectors. The page and the AI may edit the same file: every save carries the stamp it read, and a change
// made elsewhere is either loaded (nothing unsaved here) or offered as a choice (unsaved edits here). Nothing is
// overwritten silently.

/** The connectors directory the douyin-live extension registers under (its package name). */
export const CONNECTOR_DIR = 'douyin-live';
export const EXAMPLE = '把Audience BOT 的人格改得更活泼一点，多跟观众互动';
/** Step 2: what the person says in the chat beside the live room (the douyin-live-reply skill takes it from there). */
export const TAKEOVER = '接管这个抖音直播间';
/** Whether the three steps are folded, in this mini app's own localStorage. */
export const STEPS_KEY = 'audience-bot.steps.collapsed';
const DEFAULT_LIMIT = 16384;

const TEXT = {
  unsupported: '这个 Dozin 版本还不能在这里编辑人格：需要支持 MAESTROSDK.connectors 的版本。',
  loadFailed: '读不到人格文件，请稍后再打开这一页。',
  changedLoaded: '人格刚在别处改过，已载入新内容。',
  theirsLoaded: '已载入别处改的内容。',
  conflict: '人格刚在别处改过，你这里还有没保存的修改。',
  saveFailed: '没保存上，请再试一次。',
  saved: '已保存',
  unsaved: '未保存',
  saving: '保存中…',
  copyFailed: '复制失败，请手动选中复制。'
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Wires the page. `sdk` is window.MAESTROSDK (may be missing on older Dozin builds or in a plain browser);
 * `clipboard` defaults to navigator.clipboard. Returns the page state for tests.
 */
export function mount(doc, sdk, { clipboard, storage } = {}) {
  const el = (name) => doc.querySelector(`[name="${name}"]`);
  const editor = el('audience-bot__persona-text');
  const pathEl = el('audience-bot__persona-path');
  const sizeEl = el('audience-bot__persona-size');
  const stateEl = el('audience-bot__persona-state');
  const saveBtn = el('audience-bot__save');
  const warning = el('audience-bot__persona-warning');
  const notice = el('audience-bot__notice');
  const noticeText = el('audience-bot__notice-text');
  const useTheirs = el('audience-bot__use-theirs');
  const useMine = el('audience-bot__use-mine');
  const copyPath = el('audience-bot__copy-path');
  const copyExample = el('audience-bot__copy-example');
  el('audience-bot__example-text').textContent = EXAMPLE;
  el('audience-bot__takeover-text').textContent = TAKEOVER;
  const stepsToggle = el('audience-bot__steps-toggle');
  const stepsList = el('audience-bot__steps-list');
  const copyTakeover = el('audience-bot__copy-takeover');

  const connectors = sdk?.connectors;
  const board = clipboard ?? globalThis.navigator?.clipboard;
  const state = { path: '', stamp: 'missing', saved: '', limit: DEFAULT_LIMIT, saving: false, conflictStamp: '', seenWhileSaving: '' };

  const dirty = () => editor.value !== state.saved;

  const show = (kind, message) => {
    notice.hidden = !kind;
    notice.className = `persona-notice${kind && kind !== 'info' ? ` persona-notice--${kind}` : ''}`;
    noticeText.textContent = message ?? '';
    useTheirs.hidden = kind !== 'conflict';
    useMine.hidden = kind !== 'conflict';
  };

  const render = () => {
    const bytes = new TextEncoder().encode(editor.value).length;
    sizeEl.textContent = kb(bytes);
    warning.hidden = bytes <= state.limit;
    warning.textContent = bytes > state.limit ? `超过 ${kb(state.limit)} 的部分不会进对话（现在 ${kb(bytes)}）。` : '';
    stateEl.textContent = state.saving ? TEXT.saving : dirty() ? TEXT.unsaved : state.path ? TEXT.saved : '';
    saveBtn.disabled = !connectors || state.saving || !dirty();
  };

  const conflict = (stamp) => {
    state.conflictStamp = stamp;
    show('conflict', TEXT.conflict);
  };

  const load = async (message) => {
    let file;
    try {
      file = await connectors.readAgentMd(CONNECTOR_DIR);
    } catch {
      show('error', TEXT.loadFailed);
      return;
    }
    state.path = file.path;
    state.stamp = file.stamp;
    state.saved = file.content ?? '';
    state.limit = Number(file.limit) || DEFAULT_LIMIT;
    state.conflictStamp = '';
    editor.value = state.saved;
    pathEl.textContent = file.path;
    pathEl.title = file.path;
    show(message ? 'info' : null, message);
    render();
  };

  const save = async (stamp = state.stamp) => {
    if (!connectors || state.saving) return;
    const value = editor.value;
    state.saving = true;
    state.seenWhileSaving = '';
    render();
    try {
      const result = await connectors.writeAgentMd(CONNECTOR_DIR, value, { stamp });
      if (result?.ok) {
        state.stamp = result.stamp;
        state.saved = value;
        state.conflictStamp = '';
        show(null);
      } else if (result?.reason === 'changed') {
        conflict(result.stamp ?? '');
      } else {
        show('error', TEXT.saveFailed);
      }
    } catch {
      show('error', TEXT.saveFailed);
    } finally {
      state.saving = false;
      render();
    }
    // A change that arrived while saving and is not our own write: handle it now.
    const seen = state.seenWhileSaving;
    state.seenWhileSaving = '';
    if (seen && seen !== state.stamp) onChange({ dir: CONNECTOR_DIR, stamp: seen });
  };

  const onChange = ({ dir, stamp }) => {
    if (dir !== CONNECTOR_DIR || stamp === state.stamp) return;
    if (state.saving) {
      state.seenWhileSaving = stamp;
      return;
    }
    if (dirty()) conflict(stamp);
    else void load(TEXT.changedLoaded);
  };

  const copy = async (button, text) => {
    try {
      await board.writeText(text);
      button.classList.add('icon-btn--done');
      setTimeout(() => button.classList.remove('icon-btn--done'), 1200);
    } catch {
      show('error', TEXT.copyFailed);
    }
  };

  const ready = (async () => {
    if (!connectors) {
      editor.disabled = true;
      copyPath.disabled = true;
      show('error', TEXT.unsupported);
      render();
      return;
    }
    editor.addEventListener('input', render);
    saveBtn.addEventListener('click', () => void save());
    doc.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        if (dirty()) void save();
      }
    });
    useTheirs.addEventListener('click', () => void load(TEXT.theirsLoaded));
    useMine.addEventListener('click', async () => {
      let stamp = state.conflictStamp;
      if (!stamp) {
        try {
          stamp = (await connectors.readAgentMd(CONNECTOR_DIR)).stamp;
        } catch {
          show('error', TEXT.saveFailed);
          return;
        }
      }
      await save(stamp);
    });
    copyPath.addEventListener('click', () => void copy(copyPath, state.path));
    connectors.onAgentMdChange(onChange);
    // Refreshing would drop unsaved edits: ask first (the host's native dialog).
    sdk.beforeRefresh?.(async () => !dirty() || (await sdk.confirm({
      title: '刷新人格页？',
      message: '还有没保存的修改，刷新后会丢失。',
      confirmLabel: '刷新',
      cancelLabel: '取消'
    })));
    await load();
  })();

  // The three steps: folded or not, remembered across restarts (this app's own partition).
  const readFolded = () => {
    try {
      return (storage ?? globalThis.localStorage)?.getItem(STEPS_KEY) === '1';
    } catch {
      return false;
    }
  };
  const fold = (folded) => {
    stepsList.hidden = folded;
    stepsToggle.textContent = folded ? '展开' : '收起';
    stepsToggle.setAttribute('aria-expanded', folded ? 'false' : 'true');
  };
  fold(readFolded());
  stepsToggle.addEventListener('click', () => {
    const folded = !stepsList.hidden;
    fold(folded);
    try {
      (storage ?? globalThis.localStorage)?.setItem(STEPS_KEY, folded ? '1' : '0');
    } catch {
      // Not remembered this time; the page still works.
    }
  });
  copyTakeover.addEventListener('click', () => void copy(copyTakeover, TAKEOVER));

  // Carries the file path, so the AI edits the right file.
  copyExample.addEventListener('click', () => void copy(copyExample, state.path ? `${EXAMPLE}（人格文件：${state.path}）` : EXAMPLE));

  return { state, ready, save, load };
}

if (typeof document !== 'undefined') mount(document, globalThis.MAESTROSDK);
