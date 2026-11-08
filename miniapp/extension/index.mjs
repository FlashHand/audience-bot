// douyin-live: a Douyin live room as a Dozin Gateway connector with `chat` (docs/design.md in this repository).
// Comments come from an observer in the room tab, the host's voice from the caption program's snapshot file; both go
// to the Gateway, which puts them into the chat attached to this connector. The chat's replies come back to `send`.
// With `voice: "tab"` the extension captures the room tab's own audio instead (docs/design.md #8; step 1: measured only).
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { addToPanel, observeRoom, sendInRoom, setPanelStatus, showPanel } from './room.mjs'
import { startTabVoice } from './voice.mjs'

const SYSTEM_PROMPT = [
  '你在抖音直播间里替这个账号回弹幕。',
  '- 每条回复只针对一条消息：gateway_send 的 reply_to 填那条的 #n；一句话，不超过 50 字。',
  '- 主播（host）说的话优先；观众（viewer）的弹幕按需回；自己（self）的消息只作上下文，绝不回复。',
  '- 不需要回就不调用 gateway_send。',
  '- 不谈钱、转账、密钥、账号凭证和任何人的隐私；不答应线下见面；不冒充主播。'
].join('\n')

const LIMIT = 50
const TICK_MS = 1000
const OBSERVER_ID = 'douyin-comments'
const PANEL_ID = 'audience-panel'
const VOICE_FILE_LIMIT = 512 * 1024
const VOICE_RETRY_MS = 3000
const ROOM = /^\d{6,20}$/
const TAB = /^tab-\d+$/

/** target.json in this extension's data directory, written by the douyin-live-reply skill; undefined when unusable. */
const readTarget = async () => {
  try {
    const raw = JSON.parse(await readFile(join(process.cwd(), 'target.json'), 'utf8'))
    if (!raw || !TAB.test(raw.tabId) || !ROOM.test(String(raw.room))) return undefined
    return {
      tabId: raw.tabId,
      room: String(raw.room),
      ownName: typeof raw.ownName === 'string' ? raw.ownName : '',
      voiceFile: typeof raw.voiceFile === 'string' && raw.voiceFile ? raw.voiceFile : '',
      voice: raw.voice === 'tab' ? 'tab' : ''
    }
  } catch {
    return undefined
  }
}

const sameTarget = (a, b) => Boolean(a && b) && a.tabId === b.tabId && a.room === b.room && a.ownName === b.ownName && a.voiceFile === b.voiceFile && a.voice === b.voice

/** `@nickname ` in front when it still fits; a reply to the host or to oneself has none. */
export const replyText = (reply) => {
  const text = String(reply.text ?? '').trim()
  const to = reply.replyTo
  if (!to?.senderName || to.role === 'host' || to.role === 'self') return text
  const mentioned = `@${to.senderName} ${text}`
  return mentioned.length <= LIMIT ? mentioned : text
}

export function activate(dozin) {
  let ctx
  let timer
  let unsubscribe
  let target
  let room
  let busy = false
  let problem = ''
  let voiceSince = 0
  const voiceSeen = new Set()
  const results = new Map()
  /** The room tab's audio capture (#8.1); `voiceBlocked` holds a failure that waits for a new target or takeover. */
  let voice
  let voiceRetryAt = 0
  let voiceBlocked = ''

  const stopVoice = async () => {
    const current = voice
    voice = undefined
    voiceRetryAt = 0
    voiceBlocked = ''
    await current?.stop()
  }

  const ensureVoice = () => {
    if (voice || voiceBlocked || Date.now() < voiceRetryAt) return
    const tabId = room.tabId
    const current = startTabVoice({
      browser: ctx.browser,
      tabId,
      log: (text) => ctx?.log(text),
      setStatus: (text) => void ctx?.browser.evaluate(tabId, { source: setPanelStatus.toString(), args: { text } }).catch(() => {}),
      onEnd: ({ retry, code }) => {
        if (voice !== current) return
        voice = undefined
        if (retry) voiceRetryAt = Date.now() + VOICE_RETRY_MS
        else voiceBlocked = code
      }
    })
    voice = current
  }

  const release = async () => {
    await stopVoice()
    const current = room
    room = undefined
    if (!current || !ctx?.browser) return
    await ctx.browser.releaseTab(current.tabId).catch(() => {})
    ctx.log(`released ${current.tabId}`)
  }

  /** Tried every second until it works: each problem is logged once, not every second. */
  const report = (text) => {
    if (text !== problem) ctx.log(text)
    problem = text
  }

  const adopt = async (wanted) => {
    let tab
    try {
      tab = await ctx.browser.adoptTab(wanted.tabId)
    } catch (error) {
      return report(`waiting for ${wanted.tabId}: ${error?.code || error?.message || 'not granted'}`)
    }
    const url = new URL(tab.url)
    if (url.origin !== 'https://live.douyin.com' || url.pathname !== `/${wanted.room}`) {
      await ctx.browser.releaseTab(wanted.tabId).catch(() => {})
      return report(`${wanted.tabId} is not room ${wanted.room}`)
    }
    problem = ''
    // The panel first, so the comment watcher has it from its first comment (docs/design.md #7).
    await ctx.browser.inject(wanted.tabId, { id: PANEL_ID, source: showPanel.toString(), args: { title: 'Audience BOT' } })
    await ctx.browser.inject(wanted.tabId, { id: OBSERVER_ID, source: observeRoom.toString(), args: { ownName: wanted.ownName } })
    room = { tabId: wanted.tabId, room: wanted.room }
    voiceSince = Date.now()
    voiceSeen.clear()
    ctx.log(`watching room ${wanted.room} in ${wanted.tabId}`)
  }

  /** New sentences of the caption program since this room was taken over, as the host's voice. */
  const readVoice = async (file) => {
    const info = await stat(file).catch(() => undefined)
    if (!info || info.size > VOICE_FILE_LIMIT) return
    let state
    try {
      state = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return
    }
    const messages = Array.isArray(state?.messages) ? state.messages : []
    const shown = []
    for (const item of messages.slice(-50)) {
      if (typeof item?.id !== 'string' || typeof item.text !== 'string' || !Number.isFinite(item.at)) continue
      const text = item.text.trim()
      if (!text || text.length > 500 || item.at < voiceSince || voiceSeen.has(item.id)) continue
      voiceSeen.add(item.id)
      ctx.emit({ text, msgId: `voice-${item.id}`, senderName: '主播', role: 'host', modality: 'voice', at: item.at })
      shown.push({ role: 'host', text, at: item.at })
    }
    if (voiceSeen.size > 500) for (const id of [...voiceSeen].slice(0, 250)) voiceSeen.delete(id)
    // The panel only shows them; a page that has gone away loses nothing the chat needs.
    if (shown.length && room) await ctx.browser.evaluate(room.tabId, { source: addToPanel.toString(), args: { items: shown } }).catch(() => {})
  }

  const tick = async () => {
    if (busy || !ctx) return
    busy = true
    try {
      const wanted = await readTarget()
      if (!sameTarget(wanted, target)) {
        await release()
        target = wanted
      }
      if (!target) return
      if (!room) await adopt(target)
      if (room && target.voice === 'tab') ensureVoice()
      else if (room && target.voiceFile) await readVoice(target.voiceFile)
    } catch (error) {
      ctx.log(`tick failed: ${error?.code || error?.message || 'error'}`)
    } finally {
      busy = false
    }
  }

  dozin.registerConnector({
    systemPrompt: SYSTEM_PROMPT,
    chat: { title: 'Audience BOT', roles: { host: '主播', viewer: '观众', self: '自己' }, maxLength: LIMIT, maxPerMinute: 4 },
    start(context) {
      if (!context.browser) throw new Error('browser_capability_required')
      ctx = context
      unsubscribe = ctx.browser.onEvent((event) => {
        if (!room || event.tabId !== room.tabId) return
        if (event.type === 'message' && event.injectionId === OBSERVER_ID) {
          const data = event.data ?? {}
          if (typeof data.text !== 'string') return
          ctx.emit({ text: data.text, msgId: data.id, senderName: data.senderName, role: data.role === 'self' ? 'self' : 'viewer', at: data.at })
          return
        }
        const moved = event.type === 'url-changed' && new URL(event.url).pathname !== `/${room.room}`
        // The tab closed, crashed or left the room: let it go; the next tick takes it again if target.json still says so.
        if (event.type === 'closed' || event.type === 'crashed' || moved) void release()
      })
      timer = setInterval(() => void tick(), TICK_MS)
      void tick()
    },
    async stop() {
      clearInterval(timer)
      timer = undefined
      unsubscribe?.()
      unsubscribe = undefined
      await release()
      target = undefined
      ctx = undefined
    },
    async send(reply) {
      const key = reply.idempotencyKey
      if (key && results.has(key)) return results.get(key)
      if (!room || !ctx) return { ok: false, error: 'no_room' }
      let result
      try {
        result = await ctx.browser.evaluate(room.tabId, { source: sendInRoom.toString(), args: { room: room.room, text: replyText(reply) } })
      } catch (error) {
        // The page may have run it before the error: unknown, never a sure failure.
        return { ok: false, error: 'send_timeout' }
      }
      const outcome = result && typeof result.ok === 'boolean'
        ? { ok: result.ok, ...(typeof result.verified === 'boolean' ? { verified: result.verified } : {}), ...(typeof result.error === 'string' ? { error: result.error } : {}) }
        : { ok: false, error: 'send_failed' }
      if (key) {
        results.set(key, outcome)
        if (results.size > 50) results.delete(results.keys().next().value)
      }
      return outcome
    }
  })
}
