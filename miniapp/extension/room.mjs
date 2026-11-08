// The package's three injections — code run inside the live room page (docs/design.md in this repository) — and two
// small functions the extension runs in the page to write to the panel.
// Each is passed to the page as source text, so it must not use anything from this module.
// Selectors and parsing were verified in the real live room page on 2026-11-05/06.

/**
 * The monitor panel (docs/design.md #7): the last 20 messages of the room — viewers, the host's voice, the AI's replies and
 * the account's own comments — bottom left of the page. The other injections add to it through
 * `globalThis.__audienceBotPanel.add`; text only ever goes in as textContent.
 */
export function showPanel(args, { onDispose }) {
  const LIMIT = 20;
  const SAME_MS = 120000;
  const labels = { viewer: '观众', host: '主播（语音）', ai: 'AI', self: '自己' };
  const colors = { viewer: '#7fd0ff', host: '#ffd166', ai: '#fe9ab2', self: '#b6bcc8' };
  const items = [];
  let collapsed = false;
  const panel = document.createElement('section');
  panel.setAttribute('data-audience-bot', 'panel');
  panel.style.cssText = 'position:fixed;left:12px;bottom:12px;width:320px;z-index:2147483647;background:rgba(12,14,18,.88);color:#fff;border:0;border-radius:12px;padding:8px 10px;font:12px/1.5 system-ui,-apple-system,sans-serif;box-sizing:border-box';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px';
  const title = document.createElement('strong');
  title.textContent = String(args?.title || 'Audience BOT');
  const count = document.createElement('span');
  count.style.cssText = 'flex:1;color:#b6bcc8';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('data-audience-bot', 'toggle');
  toggle.style.cssText = 'border:0;background:transparent;color:#b6bcc8;font:inherit;cursor:pointer;padding:0 4px';
  // One status line under the title (docs/design.md #8.1: the audio check), shown even when the list is collapsed.
  const status = document.createElement('div');
  status.setAttribute('data-audience-bot', 'status');
  status.style.cssText = 'margin-top:4px;color:#b6bcc8;display:none';
  const list = document.createElement('div');
  list.style.cssText = 'max-height:320px;overflow-y:auto;margin-top:6px;display:flex;flex-direction:column;gap:2px';
  head.append(title, count, toggle);
  panel.append(head, status, list);
  const render = () => {
    count.textContent = `${items.length} 条`;
    toggle.textContent = collapsed ? '展开' : '收起';
    list.style.display = collapsed ? 'none' : 'flex';
    list.replaceChildren(...items.map((item) => {
      const row = document.createElement('div');
      row.setAttribute('data-role', item.role);
      row.style.color = colors[item.role];
      const who = item.role === 'viewer' && item.name ? `${labels.viewer} · ${item.name}` : labels[item.role];
      row.textContent = `${who}：${item.text}`;
      return row;
    }));
    list.scrollTop = list.scrollHeight;
  };
  toggle.addEventListener('click', () => { collapsed = !collapsed; render(); });
  const recent = (role, text, at) => items.find((item) => item.role === role && item.text === text && Math.abs(at - item.at) <= SAME_MS);
  globalThis.__audienceBotPanel = {
    status(value) {
      const text = String(value ?? '').trim().slice(0, 120);
      status.textContent = text;
      status.style.display = text ? 'block' : 'none';
    },
    add(value) {
      const role = labels[value?.role] ? value.role : '';
      const text = String(value?.text ?? '').trim();
      if (!role || !text) return;
      const at = Number.isFinite(value.at) ? value.at : Date.now();
      // A reply the AI sent comes back as the account's own comment: one row, shown as the AI's.
      if (role === 'self' && recent('ai', text, at)) return;
      const echo = role === 'ai' && recent('self', text, at);
      if (echo) echo.role = 'ai';
      else items.push({ role, name: String(value.name ?? '').slice(0, 60), text: text.slice(0, 500), at });
      items.sort((a, b) => a.at - b.at);
      items.splice(0, Math.max(0, items.length - LIMIT));
      render();
    }
  };
  document.body.append(panel);
  render();
  onDispose(() => {
    panel.remove();
    delete globalThis.__audienceBotPanel;
  });
}

/** Sets the panel's status line when the panel is there; an empty text hides it. */
export function setPanelStatus(args) {
  globalThis.__audienceBotPanel?.status(args?.text);
  return Boolean(globalThis.__audienceBotPanel);
}

/** Adds lines to the monitor panel when it is there: the extension's way in for the host's voice. */
export function addToPanel(args) {
  for (const item of Array.isArray(args?.items) ? args.items : []) globalThis.__audienceBotPanel?.add(item);
  return Boolean(globalThis.__audienceBotPanel);
}

/** Watches the comment list; rows on screen when it starts are the baseline, every later row is one message. */
export function observeRoom(args, { emit, onDispose }) {
  const ownName = String(args?.ownName ?? '');
  const rowsRoot = () => document.querySelector('.webcast-chatroom___list')?.firstElementChild?.firstElementChild;
  const textOf = (el) => String(el.innerText ?? el.textContent ?? '').replace(/\u200b/g, '').trim();
  const seen = new WeakMap();
  let seq = 0;
  const scan = (baseline) => {
    const root = rowsRoot();
    if (!root) return false;
    for (const row of root.children) {
      const value = textOf(row);
      if (seen.get(row) === value) continue;
      seen.set(row, value);
      if (baseline) continue;
      const match = value.match(/^([^\n：]{1,60})：\s*([\s\S]+)$/);
      if (!match || match[2].startsWith('送出了')) continue;
      const name = match[1].trim();
      const at = Date.now();
      const item = { id: `c${at}-${++seq}`, text: match[2].trim(), senderName: name, role: name === ownName ? 'self' : 'viewer', at };
      emit(item);
      globalThis.__audienceBotPanel?.add({ role: item.role, name, text: item.text, at });
    }
    return true;
  };
  const observer = new MutationObserver(() => scan(false));
  const watch = () => {
    const list = document.querySelector('.webcast-chatroom___list');
    if (!list) return false;
    scan(true);
    observer.observe(list, { childList: true, subtree: true, characterData: true });
    return true;
  };
  let late;
  if (!watch()) late = setInterval(() => { if (watch()) clearInterval(late); }, 1000);
  onDispose(() => {
    clearInterval(late);
    observer.disconnect();
  });
}

/**
 * Sends one comment in one run: never over another draft; fill, press send, and count it as seen only when the text
 * shows up in the list within 5 seconds. Not seen: says whether it left the input, so nobody sends it twice.
 */
export async function sendInRoom(args) {
  const INPUT = '.webcast-chatroom___input-container [contenteditable="true"]';
  const SEND = '.webcast-chatroom___input-container svg.webcast-chatroom___send-btn';
  const LIMIT = 50;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const textOf = (el) => (el ? String(el.innerText ?? el.textContent ?? '').replace(/\u200b/g, '').trim() : '');
  if (location.origin !== 'https://live.douyin.com' || location.pathname !== `/${args.room}`) return { ok: false, error: 'wrong_room' };
  const message = String(args.text ?? '').trim();
  if (!message) return { ok: false, error: 'empty_text' };
  if (message.length > LIMIT) return { ok: false, error: `over ${LIMIT} characters` };
  const input = document.querySelector(INPUT);
  if (!input) return { ok: false, error: 'not_logged_in' };
  const current = textOf(input);
  if (current && current !== message) return { ok: false, error: 'input_busy' };
  if (current !== message) {
    input.focus();
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('insertText', false, message)) return { ok: false, error: 'fill_failed' };
    await sleep(50);
    if (textOf(input) !== message) return { ok: false, error: 'fill_failed' };
  }
  await sleep(50);
  const button = document.querySelector(SEND);
  if (!button) return { ok: false, error: 'send_button_missing' };
  const init = { bubbles: true, cancelable: true, view: window, button: 0 };
  button.dispatchEvent(new PointerEvent('pointerdown', init));
  button.dispatchEvent(new MouseEvent('mousedown', init));
  button.dispatchEvent(new PointerEvent('pointerup', init));
  button.dispatchEvent(new MouseEvent('mouseup', init));
  button.dispatchEvent(new MouseEvent('click', init));
  const list = () => textOf(document.querySelector('.webcast-chatroom___list'));
  for (const end = Date.now() + 5000; Date.now() < end; await sleep(100)) {
    if (!list().includes(message)) continue;
    globalThis.__audienceBotPanel?.add({ role: 'ai', text: message, at: Date.now() });
    return { ok: true, verified: true };
  }
  return textOf(document.querySelector(INPUT)) ? { ok: false, error: 'not_sent' } : { ok: true, verified: false };
}
