// Page script for a Douyin live room as a Dozin Gateway source (the fallback in ../SKILL.md, used when the extension is not available).
// Passed as `script` to gateway_register after replacing __OWN_NAME__ with the account's display name (JSON-quoted).
// Selectors and parsing were verified in Dozin Preview on 2026-11-05/06.
async (gw) => {
  const OWN_NAME = __OWN_NAME__;
  const LIMIT = 50;
  const rowsRoot = () => document.querySelector('.webcast-chatroom___list')?.firstElementChild?.firstElementChild;
  const seen = new WeakMap();
  let seq = 0;

  // Receive: rows already on screen are the baseline; only rows that appear or change later are messages.
  const scan = (baseline) => {
    const root = rowsRoot();
    if (!root) return;
    for (const row of root.children) {
      const value = (row.innerText || '').replace(/​/g, '').trim();
      if (seen.get(row) === value) continue;
      seen.set(row, value);
      if (baseline) continue;
      const match = value.match(/^([^\n：]{1,60})：\s*([\s\S]+)$/);
      if (!match || match[2].startsWith('送出了')) continue;
      const name = match[1].trim();
      gw.emit({ id: `chat-${Date.now()}-${++seq}`, text: match[2].trim(), senderName: name, role: name === OWN_NAME ? 'self' : 'viewer' });
    }
  };
  scan(true);
  const observer = new MutationObserver(() => scan(false));
  const watch = () => {
    const list = document.querySelector('.webcast-chatroom___list');
    if (list) observer.observe(list, { childList: true, subtree: true, characterData: true });
    return Boolean(list);
  };
  if (!watch()) {
    const late = setInterval(() => { if (watch()) { clearInterval(late); scan(true); } }, 1000);
    gw.onDispose(() => clearInterval(late));
  }
  gw.onDispose(() => observer.disconnect());

  // Send: one call fills, waits for render, presses and checks the echo. No model turn in between.
  gw.onSend(async ({ text, replyTo }) => {
    const target = replyTo && replyTo.senderName && replyTo.senderName !== OWN_NAME ? replyTo.senderName : '';
    const message = (target ? `@${target} ` : '') + String(text).trim();
    if (message.length > LIMIT) return { ok: false, error: `over ${LIMIT} UTF-16 units (${message.length})` };
    const input = '.webcast-chatroom___input-container [contenteditable="true"]';
    const current = gw.ui.text(input);
    if (current && current !== message) return { ok: false, error: 'the input holds another draft; left as it is' };
    if (current !== message) {
      const filled = await gw.ui.fill(input, message);
      if (!filled.ok) return { ok: false, error: `fill: ${filled.error}` };
    }
    await gw.ui.sleep(50);
    const pressed = await gw.ui.press('svg.webcast-chatroom___send-btn');
    if (!pressed.ok) return { ok: false, error: `press: ${pressed.error}` };
    const echoed = await gw.ui.waitFor(() => (document.querySelector('.webcast-chatroom___list')?.innerText || '').includes(message), 5000);
    if (echoed) return { ok: true, verified: true };
    // Not echoed: say whether it left the input, so the chat never resends a message that may be out.
    return gw.ui.text(input) ? { ok: false, error: 'not sent; the draft is still in the input' } : { ok: true, verified: false };
  });
}
