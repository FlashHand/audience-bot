// The package's two injections — code run inside the live room page (docs/design.md in this repository).
// Each is passed to the page as source text, so it must not use anything from this module.
// Selectors and parsing were verified in the real live room page on 2026-11-05/06.

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
      emit({ id: `c${at}-${++seq}`, text: match[2].trim(), senderName: name, role: name === ownName ? 'self' : 'viewer', at });
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
  for (const end = Date.now() + 5000; Date.now() < end; await sleep(100)) if (list().includes(message)) return { ok: true, verified: true };
  return textOf(document.querySelector(INPUT)) ? { ok: false, error: 'not_sent' } : { ok: true, verified: false };
}
