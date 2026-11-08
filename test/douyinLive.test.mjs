// Contract: docs/design.md — the douyin-live package: its manifest, the comment observer and the send step on a fake
// room page, and the connector's cycle (target.json → take the tab → comments and voice → replies).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'

const packageDir = new URL('../extension/douyin-live/', import.meta.url)
const { observeRoom, sendInRoom } = await import(new URL('room.mjs', packageDir))
const { activate, replyText } = await import(new URL('index.mjs', packageDir))

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((done) => setImmediate(done)) }

/** A room page: rows are `<div><span>name：</span><span>text</span></div>` under list > div > div, as in the real page. */
const roomPage = (rows = []) => {
  const { window, document } = parseHTML(`<html><body>
    <div class="webcast-chatroom___list"><div><div>${rows.map((row) => `<div>${row}</div>`).join('')}</div></div></div>
    <div class="webcast-chatroom___input-container"><div contenteditable="true"></div><svg class="webcast-chatroom___send-btn"></svg></div>
  </body></html>`)
  return { window, document, rowsRoot: document.querySelector('.webcast-chatroom___list').firstElementChild.firstElementChild }
}

/** Runs one of the page functions with the page's globals in place. */
const withPage = async (page, globals, run) => {
  const names = ['document', 'MutationObserver', 'location', 'getSelection', 'PointerEvent', 'MouseEvent', 'window']
  const saved = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const values = { document: page.document, MutationObserver: page.window.MutationObserver, window: page.window, MouseEvent: page.window.Event, PointerEvent: page.window.Event, ...globals }
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  try { return await run() } finally {
    for (const name of names) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name])
      else delete globalThis[name]
    }
  }
}

test('the package needs only its name and the browser capability; its connector has a chat and a short system prompt', async () => {
  assert.deepEqual(readdirSync(packageDir).sort(), ['index.mjs', 'package.json', 'room.mjs'])
  const manifest = JSON.parse(readFileSync(new URL('package.json', packageDir), 'utf8'))
  assert.equal(manifest.name, 'douyin-live', 'the connectors directory is named after the package')
  assert.equal(manifest.main, undefined, 'the entry falls back to index.mjs')
  assert.equal(manifest.pi, undefined)
  assert.deepEqual(manifest.dozin.capabilities, ['browser'])
  assert.deepEqual(manifest.dozin.origins, ['https://live.douyin.com'])
  let definition
  activate({ registerConnector: (value) => { definition = value }, log() {} })
  assert.equal(definition.id, undefined, 'the id defaults to the package name')
  assert.ok(Array.from(definition.systemPrompt).length <= 4000)
  assert.deepEqual(definition.chat, { title: 'Audience BOT', roles: { host: '主播', viewer: '观众', self: '自己' }, maxLength: 50, maxPerMinute: 4 })
  for (const name of ['start', 'stop', 'send']) assert.equal(typeof definition[name], 'function')
})

test('observer: rows on screen are the baseline; new comments are emitted, gifts skipped, own name is self', async () => {
  const page = roomPage(['<span>老张：</span><span>早就在了</span>'])
  const emitted = []
  let dispose
  await withPage(page, {}, async () => {
    observeRoom({ ownName: '我' }, { emit: (item) => emitted.push(item), onDispose: (fn) => { dispose = fn } })
    const add = (html) => { const row = page.document.createElement('div'); row.innerHTML = html; page.rowsRoot.appendChild(row) }
    add('<span>小王：</span><span>主播好</span>')
    add('<span>小李：</span><span>送出了 小心心</span>')
    add('<span>我：</span><span>欢迎</span>')
    add('<span>进入直播间</span>')
    await settle()
  })
  assert.deepEqual(emitted.map(({ text, senderName, role }) => ({ text, senderName, role })), [
    { text: '主播好', senderName: '小王', role: 'viewer' },
    { text: '欢迎', senderName: '我', role: 'self' }
  ])
  assert.ok(emitted.every((item) => typeof item.id === 'string' && Number.isFinite(item.at)))
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('send step: wrong room, not logged in, someone else\'s draft and over 50 are refused; a sent comment is verified by its echo', async () => {
  const location = { origin: 'https://live.douyin.com', pathname: '/123456789012' }
  const run = (page, args, extra = {}) => withPage(page, { location, getSelection: () => ({ removeAllRanges() {}, addRange() {} }), ...extra }, () => sendInRoom(args))
  assert.deepEqual(await run(roomPage(), { room: '1', text: 'hi' }), { ok: false, error: 'wrong_room' })
  assert.deepEqual(await run(roomPage(), { room: '123456789012', text: 'x'.repeat(51) }), { ok: false, error: 'over 50 characters' })
  const loggedOut = roomPage()
  loggedOut.document.querySelector('[contenteditable]').remove()
  assert.deepEqual(await run(loggedOut, { room: '123456789012', text: 'hi' }), { ok: false, error: 'not_logged_in' })
  const drafted = roomPage()
  drafted.document.querySelector('[contenteditable]').textContent = '我自己的草稿'
  assert.deepEqual(await run(drafted, { room: '123456789012', text: 'hi' }), { ok: false, error: 'input_busy' })

  const page = roomPage()
  const input = page.document.querySelector('[contenteditable]')
  page.document.createRange = () => ({ selectNodeContents() {} })
  page.document.execCommand = (command, _ui, value) => { assert.equal(command, 'insertText'); input.textContent = value; return true }
  page.document.querySelector('svg').addEventListener('click', () => {
    const row = page.document.createElement('div')
    row.textContent = `我：${input.textContent}`
    page.rowsRoot.appendChild(row)
    input.textContent = ''
  })
  assert.deepEqual(await run(page, { room: '123456789012', text: '@小王 马上安排' }), { ok: true, verified: true })
})

test('reply text: @nickname in front only for a viewer and only when it fits', () => {
  assert.equal(replyText({ text: '好的', replyTo: { senderName: '小王', role: 'viewer' } }), '@小王 好的')
  assert.equal(replyText({ text: '好的', replyTo: { senderName: '主播', role: 'host' } }), '好的')
  assert.equal(replyText({ text: '好的' }), '好的')
  assert.equal(replyText({ text: 'x'.repeat(48), replyTo: { senderName: '小王', role: 'viewer' } }), 'x'.repeat(48))
})

test('connector: waits for target.json, takes the tab, emits comments and new voice lines, sends once per key, lets go', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'douyin-live-'))
  const cwd = process.cwd()
  process.chdir(dir)
  t.after(() => process.chdir(cwd))
  const voiceFile = join(dir, 'continuous-state.json')
  let definition
  activate({ registerConnector: (value) => { definition = value }, log() {} })
  const calls = []
  let listener
  const emits = []
  let granted = false
  const browser = {
    async adoptTab(tabId) { calls.push(['adopt', tabId]); if (!granted) throw Object.assign(new Error('tab_not_granted'), { code: 'tab_not_granted' }); return { tabId, url: 'https://live.douyin.com/123456789012', documentId: 1 } },
    async releaseTab(tabId) { calls.push(['release', tabId]) },
    async inject(tabId, script) { calls.push(['inject', tabId, script.id, script.args]); assert.match(script.source, /webcast-chatroom___list/) },
    async evaluate(tabId, script) { calls.push(['evaluate', tabId, script.args]); return { ok: true, verified: true } },
    onEvent(fn) { listener = fn; return () => { listener = undefined } }
  }
  const logs = []
  definition.start({ browser, emit: (message) => emits.push(message), log: (text) => logs.push(text) })
  await settle()
  assert.deepEqual(calls, [], 'no target.json: nothing is taken')
  assert.deepEqual(await definition.send({ text: 'hi' }), { ok: false, error: 'no_room' })

  writeFileSync(join(dir, 'target.json'), JSON.stringify({ tabId: 'tab-28', room: '123456789012', ownName: '我', voiceFile }))
  await new Promise((done) => setTimeout(done, 1100))
  assert.deepEqual(calls.at(-1), ['adopt', 'tab-28'], 'tries the tab, waits while it is not allowed')
  granted = true
  await new Promise((done) => setTimeout(done, 1100))
  assert.deepEqual(calls.slice(-2).map((call) => call[0]), ['adopt', 'inject'])
  assert.deepEqual(calls.at(-1), ['inject', 'tab-28', 'douyin-comments', { ownName: '我' }])

  listener({ type: 'message', tabId: 'tab-28', injectionId: 'douyin-comments', data: { id: 'c1', text: '主播好', senderName: '小王', role: 'viewer', at: 5 } })
  listener({ type: 'message', tabId: 'tab-9', injectionId: 'douyin-comments', data: { id: 'c2', text: '别的标签页', senderName: 'x', role: 'viewer', at: 5 } })
  assert.deepEqual(emits, [{ text: '主播好', msgId: 'c1', senderName: '小王', role: 'viewer', at: 5 }])

  writeFileSync(voiceFile, JSON.stringify({ messages: [{ id: 'old', text: '接管前的话', at: 1 }, { id: 'v1', text: '欢迎大家', at: Date.now() + 10 }] }))
  await new Promise((done) => setTimeout(done, 1100))
  await new Promise((done) => setTimeout(done, 1100))
  const voice = emits.filter((message) => message.role === 'host')
  assert.deepEqual(voice.map(({ text, msgId, modality }) => ({ text, msgId, modality })), [{ text: '欢迎大家', msgId: 'voice-v1', modality: 'voice' }], 'only lines after the takeover, each once')

  const reply = { text: '马上安排', idempotencyKey: 'k1', replyTo: { id: 'c1', senderId: '', senderName: '小王', role: 'viewer' } }
  assert.deepEqual(await definition.send(reply), { ok: true, verified: true })
  assert.deepEqual(await definition.send(reply), { ok: true, verified: true })
  const evaluations = calls.filter((call) => call[0] === 'evaluate')
  assert.equal(evaluations.length, 1, 'the same key is sent once')
  assert.deepEqual(evaluations[0][2], { room: '123456789012', text: '@小王 马上安排' })

  listener({ type: 'url-changed', tabId: 'tab-28', url: 'https://live.douyin.com/111111111' })
  await settle()
  assert.deepEqual(calls.at(-1), ['release', 'tab-28'], 'leaving the room lets the tab go')
  await definition.stop()
  assert.equal(listener, undefined)
})
