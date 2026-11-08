// Contract: docs/design.md — the douyin-live package: its manifest, the comment observer and the send step on a fake
// room page, and the connector's cycle (target.json → take the tab → comments and voice → replies).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'

const packageDir = new URL('../miniapp/extension/', import.meta.url)
const { addToPanel, observeRoom, sendInRoom, setPanelStatus, showPanel } = await import(new URL('room.mjs', packageDir))
const { FLOOR_DB, failureText, levelDb, levelText, startTabVoice } = await import(new URL('voice.mjs', packageDir))
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
  assert.deepEqual(readdirSync(packageDir).sort(), ['index.mjs', 'package.json', 'room.mjs', 'voice.mjs'])
  const manifest = JSON.parse(readFileSync(new URL('package.json', packageDir), 'utf8'))
  assert.equal(manifest.name, 'douyin-live', 'the connectors directory is named after the package')
  assert.equal(manifest.main, undefined, 'the entry falls back to index.mjs')
  assert.equal(manifest.pi, undefined)
  assert.deepEqual(manifest.dozin.capabilities, ['browser', 'audio'])
  assert.equal(manifest.dozin.platforms, undefined, 'no platform gate: comments keep working where audio cannot')
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
    async inject(tabId, script) { calls.push(['inject', tabId, script.id, script.args]); assert.match(script.source, script.id === 'audience-panel' ? /__audienceBotPanel/ : /webcast-chatroom___list/) },
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
  assert.deepEqual(calls.slice(-3).map((call) => call[0]), ['adopt', 'inject', 'inject'])
  assert.deepEqual(calls.at(-2), ['inject', 'tab-28', 'audience-panel', { title: 'Audience BOT' }], 'the panel goes in first')
  assert.deepEqual(calls.at(-1), ['inject', 'tab-28', 'douyin-comments', { ownName: '我' }])

  listener({ type: 'message', tabId: 'tab-28', injectionId: 'douyin-comments', data: { id: 'c1', text: '主播好', senderName: '小王', role: 'viewer', at: 5 } })
  listener({ type: 'message', tabId: 'tab-9', injectionId: 'douyin-comments', data: { id: 'c2', text: '别的标签页', senderName: 'x', role: 'viewer', at: 5 } })
  assert.deepEqual(emits, [{ text: '主播好', msgId: 'c1', senderName: '小王', role: 'viewer', at: 5 }])

  writeFileSync(voiceFile, JSON.stringify({ messages: [{ id: 'old', text: '接管前的话', at: 1 }, { id: 'v1', text: '欢迎大家', at: Date.now() + 10 }] }))
  await new Promise((done) => setTimeout(done, 1100))
  await new Promise((done) => setTimeout(done, 1100))
  const voice = emits.filter((message) => message.role === 'host')
  assert.deepEqual(voice.map(({ text, msgId, modality }) => ({ text, msgId, modality })), [{ text: '欢迎大家', msgId: 'voice-v1', modality: 'voice' }], 'only lines after the takeover, each once')
  const panelAdds = calls.filter((call) => call[0] === 'evaluate' && call[2]?.items)
  assert.equal(panelAdds.length, 1, 'the host\'s new line goes to the panel once')
  assert.deepEqual(panelAdds[0][2].items.map(({ role, text }) => ({ role, text })), [{ role: 'host', text: '欢迎大家' }])

  const reply = { text: '马上安排', idempotencyKey: 'k1', replyTo: { id: 'c1', senderId: '', senderName: '小王', role: 'viewer' } }
  assert.deepEqual(await definition.send(reply), { ok: true, verified: true })
  assert.deepEqual(await definition.send(reply), { ok: true, verified: true })
  const evaluations = calls.filter((call) => call[0] === 'evaluate' && call[2]?.room)
  assert.equal(evaluations.length, 1, 'the same key is sent once')
  assert.deepEqual(evaluations[0][2], { room: '123456789012', text: '@小王 马上安排' })

  listener({ type: 'url-changed', tabId: 'tab-28', url: 'https://live.douyin.com/111111111' })
  await settle()
  assert.deepEqual(calls.at(-1), ['release', 'tab-28'], 'leaving the room lets the tab go')
  await definition.stop()
  assert.equal(listener, undefined)
})

// docs/design.md #7: the monitor panel — four roles, last 20, the AI's echo shown once, collapsible, gone on dispose.
test('panel: shows viewers, the host and the AI; the AI echo is one row whichever comes first; 20 rows; collapses; leaves', async () => {
  const page = roomPage()
  let dispose
  await withPage(page, {}, async () => {
    showPanel({ title: 'Audience BOT' }, { onDispose: (fn) => { dispose = fn } })
    const panel = globalThis.__audienceBotPanel
    assert.ok(panel, 'the panel is reachable for the other injections')
    panel.add({ role: 'viewer', name: '小王', text: '主播好', at: 1 })
    panel.add({ role: 'host', text: '欢迎大家', at: 2 })
    panel.add({ role: 'self', text: '@小王 来啦', at: 3 })
    panel.add({ role: 'ai', text: '@小王 来啦', at: 4 })
    panel.add({ role: 'ai', text: '谢谢支持', at: 5 })
    panel.add({ role: 'self', text: '谢谢支持', at: 6 })
    panel.add({ role: 'self', text: '我自己打的', at: 7 })
    panel.add({ role: 'nobody', text: 'x', at: 8 })
    panel.add({ role: 'viewer', text: '   ', at: 9 })
    panel.add({ role: 'viewer', name: '<b>x</b>', text: '<img src=x onerror=alert(1)>', at: 10 })
    const rows = () => [...page.document.querySelectorAll('[data-audience-bot="panel"] [data-role]')]
    assert.deepEqual(rows().map((row) => [row.getAttribute('data-role'), row.textContent]), [
      ['viewer', '观众 · 小王：主播好'],
      ['host', '主播（语音）：欢迎大家'],
      ['ai', 'AI：@小王 来啦'],
      ['ai', 'AI：谢谢支持'],
      ['self', '自己：我自己打的'],
      ['viewer', '观众 · <b>x</b>：<img src=x onerror=alert(1)>']
    ])
    assert.ok(page.document.querySelector('[data-audience-bot="panel"] img') === null, 'comment text never becomes markup')
    for (let i = 0; i < 30; i++) panel.add({ role: 'viewer', name: 'n', text: `第${i}条`, at: 100 + i })
    assert.equal(rows().length, 20)
    assert.equal(rows().at(-1).textContent, '观众 · n：第29条')
    assert.equal(addToPanel({ items: [{ role: 'host', text: '最后一句', at: 999 }] }), true)
    assert.equal(rows().at(-1).textContent, '主播（语音）：最后一句')
    const toggle = page.document.querySelector('[data-audience-bot="toggle"]')
    assert.equal(toggle.textContent, '收起')
    toggle.dispatchEvent(new page.window.Event('click'))
    assert.equal(toggle.textContent, '展开')
    dispose()
    assert.ok(page.document.querySelector('[data-audience-bot="panel"]') === null, 'the panel leaves with the injection')
    assert.equal(globalThis.__audienceBotPanel, undefined)
    assert.equal(addToPanel({ items: [{ role: 'host', text: 'x' }] }), false, 'no panel, nothing to add to')
  })
})

test('panel: the comment watcher and the send step feed it', async () => {
  const page = roomPage()
  const location = { origin: 'https://live.douyin.com', pathname: '/123456789012' }
  await withPage(page, { location, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) }, async () => {
    let disposePanel, disposeWatcher
    showPanel({}, { onDispose: (fn) => { disposePanel = fn } })
    observeRoom({ ownName: '我' }, { emit() {}, onDispose: (fn) => { disposeWatcher = fn } })
    const add = (text) => { const row = page.document.createElement('div'); row.textContent = text; page.rowsRoot.appendChild(row) }
    add('小王：主播唱首歌')
    await settle()
    const input = page.document.querySelector('[contenteditable]')
    page.document.createRange = () => ({ selectNodeContents() {} })
    page.document.execCommand = (_command, _ui, value) => { input.textContent = value; return true }
    page.document.querySelector('svg').addEventListener('click', () => { add(`我：${input.textContent}`); input.textContent = '' })
    assert.deepEqual(await sendInRoom({ room: '123456789012', text: '@小王 马上安排' }), { ok: true, verified: true })
    await settle()
    const rows = [...page.document.querySelectorAll('[data-audience-bot="panel"] [data-role]')].map((row) => [row.getAttribute('data-role'), row.textContent])
    assert.deepEqual(rows, [['viewer', '观众 · 小王：主播唱首歌'], ['ai', 'AI：@小王 马上安排']], 'the reply shows once, as the AI\'s')
    disposeWatcher()
    disposePanel()
  })
})

// docs/design.md #8.1: the audio check — the room tab's own audio, measured once a second; nothing reaches the chat.
const fakeAudio = (frames, { fail } = {}) => {
  const calls = []
  let release
  const ended = new Promise((done) => { release = done })
  return {
    calls,
    finish: () => release(),
    browser: {
      async captureAudio(tabId) {
        calls.push(['capture', tabId])
        if (fail) throw Object.assign(new Error(fail), { code: fail })
        return {
          tabId,
          frames: { async *[Symbol.asyncIterator]() { for (const frame of frames) yield frame; await ended } },
          async stop() { calls.push(['stop', tabId]); release() }
        }
      }
    }
  }
}
const frame = (sequence, value, length = 1600) => ({ sequence, pcm: new Float32Array(length).fill(value) })

test('voice: levels in dB, silence below -60, failures in plain words', () => {
  assert.equal(levelDb(0, 0), FLOOR_DB)
  assert.equal(levelDb(0, 100), FLOOR_DB)
  assert.equal(levelDb(100 * 0.5 * 0.5, 100), -6)
  assert.equal(levelDb(100 * 1e-6 * 1e-6, 100), FLOOR_DB)
  assert.equal(levelText(-61), '采音：本标签页 · 静音')
  assert.equal(levelText(-23), '采音：本标签页 · 音量 -23 dB')
  assert.equal(failureText('audio_platform_unsupported'), '采音失败：只支持 macOS Apple 芯片')
  assert.equal(failureText('weird_code'), '采音失败：weird_code')
})

test('voice: one level line a second, a summary every 10 s with missing frames; stop ends it without onEnd', async () => {
  let clock = 0
  const frames = []
  for (let i = 0; i < 12; i++) frames.push(frame(i < 3 ? i : i + 2, i < 6 ? 0.5 : 0))
  const audio = fakeAudio(frames)
  const status = []
  const logs = []
  const ends = []
  const voice = startTabVoice({ browser: audio.browser, tabId: 'tab-28', setStatus: (text) => status.push(text), log: (text) => logs.push(text), onEnd: (detail) => ends.push(detail), now: () => (clock += 1000) })
  await settle()
  assert.deepEqual(audio.calls, [['capture', 'tab-28']])
  assert.equal(status[0], '采音：正在启动…')
  assert.equal(status[1], '采音：本标签页 · 音量 -6 dB')
  assert.equal(status.at(-1), '采音：本标签页 · 静音')
  const summary = logs.find((line) => line.startsWith('voice: ') && line.includes('frames'))
  assert.match(summary, /s with sound, peak -6 dB/)
  assert.match(summary, /, 2 missing$/, 'the two skipped sequence numbers are counted')
  assert.ok(logs.every((line) => !/0\.5/.test(line)), 'no audio values in the log')
  await voice.stop()
  await settle()
  assert.deepEqual(audio.calls.at(-1), ['stop', 'tab-28'])
  assert.deepEqual(ends, [], 'stopping is not an end the caller retries')
})

test('voice: a failure says why and whether to retry; a stream that ends by itself asks for a retry', async () => {
  const run = async (fail) => {
    const audio = fakeAudio([], { fail })
    const status = []
    const ends = []
    startTabVoice({ browser: audio.browser, tabId: 'tab-28', setStatus: (text) => status.push(text), log() {}, onEnd: (detail) => ends.push(detail) })
    await settle()
    return { status, ends }
  }
  assert.deepEqual(await run('audio_platform_unsupported'), { status: ['采音：正在启动…', '采音失败：只支持 macOS Apple 芯片'], ends: [{ retry: false, code: 'audio_platform_unsupported' }] })
  assert.deepEqual((await run('stale_document')).ends, [{ retry: true, code: 'stale_document' }])
  const audio = fakeAudio([frame(0, 0.1)])
  const ends = []
  const status = []
  startTabVoice({ browser: audio.browser, tabId: 'tab-28', setStatus: (text) => status.push(text), log() {}, onEnd: (detail) => ends.push(detail) })
  await settle()
  audio.finish()
  await settle()
  assert.deepEqual(ends, [{ retry: true, code: 'audio_ended' }])
  assert.equal(status.at(-1), '采音已停止，稍后重试')
})

test('panel: the status line shows, hides when empty, and stays when the list is collapsed', async () => {
  const page = roomPage()
  let dispose
  await withPage(page, {}, async () => {
    showPanel({}, { onDispose: (fn) => { dispose = fn } })
    const line = () => page.document.querySelector('[data-audience-bot="status"]')
    assert.equal(line().style.display, 'none')
    assert.equal(setPanelStatus({ text: '采音：本标签页 · 音量 -20 dB' }), true)
    assert.equal(line().textContent, '采音：本标签页 · 音量 -20 dB')
    assert.equal(line().style.display, 'block')
    page.document.querySelector('[data-audience-bot="toggle"]').dispatchEvent(new page.window.Event('click'))
    assert.equal(line().style.display, 'block')
    setPanelStatus({ text: '' })
    assert.equal(line().style.display, 'none')
    dispose()
    assert.equal(setPanelStatus({ text: 'x' }), false)
  })
})

test('connector: voice "tab" captures the taken tab, writes the panel line, skips the voice file, stops on release', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'douyin-voice-'))
  const cwd = process.cwd()
  process.chdir(dir)
  t.after(() => process.chdir(cwd))
  let definition
  activate({ registerConnector: (value) => { definition = value }, log() {} })
  const audio = fakeAudio([frame(0, 0.5)])
  const calls = audio.calls
  let listener
  const browser = {
    ...audio.browser,
    async adoptTab(tabId) { calls.push(['adopt', tabId]); return { tabId, url: 'https://live.douyin.com/123456789012', documentId: 1 } },
    async releaseTab(tabId) { calls.push(['release', tabId]) },
    async inject(tabId, script) { calls.push(['inject', script.id]) },
    async evaluate(tabId, script) { calls.push(['evaluate', script.args]); return true },
    onEvent(fn) { listener = fn; return () => { listener = undefined } }
  }
  writeFileSync(join(dir, 'continuous-state.json'), JSON.stringify({ messages: [{ id: 'v1', text: '文件里的句子', at: Date.now() + 10 }] }))
  writeFileSync(join(dir, 'target.json'), JSON.stringify({ tabId: 'tab-28', room: '123456789012', ownName: '我', voice: 'tab', voiceFile: join(dir, 'continuous-state.json') }))
  const emits = []
  definition.start({ browser, emit: (message) => emits.push(message), log() {} })
  await settle()
  await new Promise((done) => setTimeout(done, 50))
  assert.deepEqual(calls.filter((call) => call[0] !== 'evaluate').map((call) => call.join(':')), ['adopt:tab-28', 'inject:audience-panel', 'inject:douyin-comments', 'capture:tab-28'])
  const lines = calls.filter((call) => call[0] === 'evaluate').map((call) => call[1].text)
  assert.equal(lines[0], '采音：正在启动…')
  await new Promise((done) => setTimeout(done, 1100))
  assert.deepEqual(emits, [], 'step 1 sends nothing to the chat; the voice file is not read')
  assert.equal(calls.filter((call) => call[0] === 'capture').length, 1, 'one capture while it runs')
  writeFileSync(join(dir, 'target.json'), JSON.stringify({ tabId: 'tab-28', room: '123456789012', ownName: '我' }))
  await new Promise((done) => setTimeout(done, 1100))
  const order = calls.map((call) => call[0])
  assert.ok(order.lastIndexOf('stop') < order.lastIndexOf('release'), 'the capture stops before the tab is let go')
  await definition.stop()
})
