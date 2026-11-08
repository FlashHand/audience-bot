// Local speech bridge for the Douyin live-reply kit.
// Starts whisper.cpp's server on 127.0.0.1:18762 and exposes /health, /speech and /captions on 127.0.0.1:18761.
// Replies are NOT generated here: the Dozin conversation model writes them (see README.md).
import { mkdir, open, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = import.meta.dir;
const runtime = resolve(root, 'runtime');
await mkdir(runtime, { recursive: true });
const emptyPublic = resolve(root, 'empty-public');
await mkdir(emptyPublic, { recursive: true });
const token = 'dozin-live-caption';
const origin = 'https://live.douyin.com';
const backendPath = '/session-' + crypto.randomUUID();
const largeModel = resolve(root, 'models/ggml-large-v3-turbo-q5_0.bin');
const modelPath = await access(largeModel).then(() => largeModel, () => resolve(root, 'models/ggml-small-q5_1.bin'));
const modelName = modelPath === largeModel ? 'whisper-large-v3-turbo-q5_0' : 'whisper-small-q5_1';
const log = await open(resolve(runtime, 'asr.log'), 'a');
const asr = Bun.spawn([
  resolve(root, 'whisper.cpp/build/bin/whisper-server'),
  '--host', '127.0.0.1', '--port', '18762', '--request-path', backendPath,
  '--public', emptyPublic, '-m', modelPath,
  '-l', 'zh', '-t', '4', '-bs', '1', '-bo', '1', '-nf',
], { cwd: runtime, stdout: 'ignore', stderr: log.fd });
let ready = false;
let speechBusy = false;
let speechCount = 0;
// Whisper hallucinates these on music or silence; observed in live rooms 2026-11-06.
const hallucination = /^(请使用简体中文和标点[。.]?|欢迎订阅我们的频道[!！。]?|谢谢[,，]?我们下次见[!！。]?|谢谢观看[!！。]?|请不吝点赞.*|字幕由.*提供.*|(中文)?字幕志愿者.*|中文字幕[:：].*|优优独播剧场.*|作[词詞][:：].*|Zither Harp)$/;
const cleanSentence = s => {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t.length > 100 || hallucination.test(t)) return false;
  if (t.length >= 12 && new Set([...t]).size / [...t].length < 0.25) return false;
  return true;
};
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, x-caption-room', 'Access-Control-Allow-Private-Network': 'true', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers });
const server = Bun.serve({
  hostname: '127.0.0.1', port: 18761, maxRequestBodySize: 600000,
  async fetch(req) {
    const url = new URL(req.url);
    const requestOrigin = req.headers.get('origin');
    if (requestOrigin && requestOrigin !== origin) return new Response('Origin denied', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/health' && req.method === 'GET') return json({ ready, speechCount, model: modelName });
    if (url.pathname === '/captions' && req.method === 'GET') {
      try {
        const state = JSON.parse(await readFile(resolve(runtime, 'continuous-state.json'), 'utf8'));
        const messages = (state.messages || []).filter(m => cleanSentence(m.text)).slice(-50).map(m => ({ id: m.id, text: m.text, at: m.at }));
        return json({ model: modelName, status: state.status, queued: state.queued, messages });
      } catch { return json({ model: modelName, status: 'no-state', messages: [] }); }
    }
    if (req.method !== 'POST' || url.pathname !== '/speech' || req.headers.get('x-caption-room') !== token) return json({ error: 'Target mismatch' }, 403);
    if (!ready || speechBusy) return json({ error: 'Speech busy or starting' }, 503);
    speechBusy = true;
    try {
      const data = new Uint8Array(await req.arrayBuffer());
      if (data.length < 32044 || data.length > 520044) return json({ error: 'Invalid audio size' }, 400);
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (new TextDecoder().decode(data.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(data.slice(8, 12)) !== 'WAVE' || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== 16000 || v.getUint16(34, true) !== 16) return json({ error: 'Expected 16k mono PCM WAV' }, 400);
      let energy = 0;
      for (let i = 44; i + 1 < data.length; i += 2) energy += (v.getInt16(i, true) / 32768) ** 2;
      if (Math.sqrt(energy / ((data.length - 44) / 2)) < 0.008) return json({ text: '', silent: true });
      const form = new FormData();
      form.set('file', new Blob([data], { type: 'audio/wav' }), 'live.wav');
      form.set('response_format', 'json');
      form.set('language', 'zh');
      form.set('temperature', '0');
      form.set('temperature_inc', '0');
      const response = await fetch('http://127.0.0.1:18762' + backendPath + '/inference', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error('ASR HTTP ' + response.status);
      const result = await response.json();
      speechCount++;
      const text = String(result.text || '').trim().split(/(?<=[。！？!?])/).map(s => s.trim()).filter(cleanSentence).join('');
      return json({ text, segmentId: crypto.randomUUID(), final: true });
    } catch (e) { console.error('Request failed:', e.name); return json({ error: e.name }, 500); }
    finally { speechBusy = false; }
  },
});
console.log('Bridge listening on http://127.0.0.1:18761; model=' + modelName);
const stop = () => { server.stop(true); asr.kill(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
asr.exited.then(code => { ready = false; console.log('ASR exited:', code); server.stop(true); process.exit(code || 1); });
for (let i = 0; i < 90 && !ready; i++) {
  try { const r = await fetch('http://127.0.0.1:18762' + backendPath + '/health', { signal: AbortSignal.timeout(1000) }); ready = r.ok; } catch {}
  if (!ready) await Bun.sleep(1000);
}
if (!ready) { console.error('ASR readiness timeout'); stop(); }
console.log('ASR ready: local Chinese transcription');
