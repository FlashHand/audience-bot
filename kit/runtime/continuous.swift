import AppKit
import ScreenCaptureKit
import AVFoundation

struct Caption: Codable {
    let id: String
    let role: String
    let text: String
    let at: Double
}
struct CaptureState: Codable {
    let source: String
    let status: String
    let audioFrames: Int
    let rms: Float
    let queued: Int
    let messages: [Caption]
}
final class ContinuousCaption: NSObject, NSApplicationDelegate, SCStreamOutput, SCStreamDelegate {
    let queue = DispatchQueue(label: "ai.dozin.live-caption.audio")
    // install.sh fills these two placeholders at build time.
    let destination = URL(fileURLWithPath: "__STATE_PATH__")
    let targetBundleId = "__TARGET_BUNDLE_ID__"
    var stream: SCStream?
    var converter: AVAudioConverter?
    var sourceFormat: AVAudioFormat?
    let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    var segment: [Float] = []
    var preRoll: [Float] = []
    var silenceFrames = 0
    var segmentAt = 0.0
    var audioFrames = 0
    var lastRMS: Float = 0
    var jobs: [(samples: [Float], at: Double)] = []
    var working = false
    var stopped = false
    var messages: [Caption] = []
    var status = "starting"
    var lastStateWrite = 0.0
    var window: NSWindow?
    var signalSource: DispatchSourceSignal?

    func save() {
        let state = CaptureState(source: "\(targetBundleId) application audio; all audible tabs", status: status, audioFrames: audioFrames, rms: lastRMS, queued: jobs.count, messages: messages)
        do { try JSONEncoder().encode(state).write(to: destination, options: .atomic) }
        catch { print("State write failed: \(error.localizedDescription)"); fflush(stdout) }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let w = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 450, height: 130), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "Dozin Live Caption — 持续中文转写"
        let label = NSTextField(wrappingLabelWithString: "正在捕获 Dozin（\(targetBundleId)）音频并本地转写。\n请仅播放目标直播间；不录麦克风或其他应用。")
        label.frame = NSRect(x: 18, y: 66, width: 410, height: 48)
        w.contentView?.addSubview(label)
        let button = NSButton(title: "停止捕获并退出", target: self, action: #selector(stopClicked))
        button.frame = NSRect(x: 18, y: 18, width: 180, height: 32)
        w.contentView?.addSubview(button)
        w.makeKeyAndOrderFront(nil)
        window = w
        signal(SIGTERM, SIG_IGN)
        signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        signalSource?.setEventHandler { [weak self] in self?.stopClicked() }
        signalSource?.resume()
        print("CAPTURE_PID=\(ProcessInfo.processInfo.processIdentifier)"); fflush(stdout)
        Task { @MainActor in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let app = content.applications.first(where: { $0.bundleIdentifier == self.targetBundleId }), let display = content.displays.first else {
                    throw NSError(domain: "Caption", code: 1, userInfo: [NSLocalizedDescriptionKey: "Dozin application (\(self.targetBundleId)) or display not found"])
                }
                let configuration = SCStreamConfiguration()
                configuration.width = 2
                configuration.height = 2
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                configuration.capturesAudio = true
                configuration.excludesCurrentProcessAudio = true
                configuration.sampleRate = 16000
                configuration.channelCount = 1
                configuration.showsCursor = false
                let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
                let capture = SCStream(filter: filter, configuration: configuration, delegate: self)
                stream = capture
                try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
                try await capture.startCapture()
                queue.async { self.status = "capturing"; self.save() }
                print("CAPTURE_STARTED: \(self.targetBundleId) audio only"); fflush(stdout)
            } catch {
                queue.async { self.status = "capture-error: \(error.localizedDescription)"; self.save() }
                print("CAPTURE_ERROR: \(error.localizedDescription)"); fflush(stdout)
                NSApp.terminate(nil)
            }
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async { self.status = "capture-error: \(error.localizedDescription)"; self.stopped = true; self.save() }
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, !stopped, buffer.isValid, let description = CMSampleBufferGetFormatDescription(buffer) else { return }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        let count = CMSampleBufferGetNumSamples(buffer)
        guard count > 0, let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)) else { return }
        input.frameLength = AVAudioFrameCount(count)
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(buffer, at: 0, frameCount: Int32(count), into: input.mutableAudioBufferList) == noErr else { status = "PCM copy failed"; save(); return }
        if sourceFormat != format { sourceFormat = format; converter = AVAudioConverter(from: format, to: targetFormat) }
        guard let converter = converter, let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: AVAudioFrameCount(Double(count) * 16000 / format.sampleRate + 64)) else { return }
        var delivered = false
        var error: NSError?
        let result = converter.convert(to: output, error: &error) { _, state in
            if delivered { state.pointee = .noDataNow; return nil }
            delivered = true; state.pointee = .haveData; return input
        }
        guard result != .error, error == nil, let channel = output.floatChannelData?[0], output.frameLength > 0 else { return }
        consume(Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength))))
    }
    func consume(_ samples: [Float]) {
        audioFrames += samples.count
        lastRMS = sqrt(samples.reduce(Float(0)) { $0 + $1 * $1 } / Float(samples.count))
        let now = Date().timeIntervalSince1970 * 1000
        let voiced = lastRMS > 0.012
        if segment.isEmpty {
            if voiced { segmentAt = now - Double(preRoll.count) / 16; segment = preRoll; preRoll.removeAll(keepingCapacity: true) }
            else { preRoll += samples; preRoll = Array(preRoll.suffix(4800)) }
        }
        if !segment.isEmpty || voiced {
            segment += samples
            silenceFrames = voiced ? 0 : silenceFrames + samples.count
            if segment.count >= 160000 || (silenceFrames >= 11200 && segment.count >= 16000) {
                if jobs.count < 3 { jobs.append((segment, segmentAt)) } else { status = "backpressure: segment dropped" }
                segment.removeAll(keepingCapacity: true); silenceFrames = 0
                runNext()
            }
        }
        if now - lastStateWrite >= 1000 { lastStateWrite = now; save() }
    }
    func wav(_ samples: [Float]) -> Data {
        var data = Data()
        func u16(_ n: UInt16) { var x = n.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        func u32(_ n: UInt32) { var x = n.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        data.append(contentsOf: "RIFF".utf8); u32(UInt32(36 + samples.count * 2)); data.append(contentsOf: "WAVEfmt ".utf8)
        u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
        data.append(contentsOf: "data".utf8); u32(UInt32(samples.count * 2))
        for sample in samples { let n = max(-1, min(1, sample)); let i = Int16(n * (n < 0 ? 32768 : 32767)); u16(UInt16(bitPattern: i)) }
        return data
    }
    func runNext() {
        guard !stopped, !working, !jobs.isEmpty else { return }
        working = true
        let job = jobs.removeFirst()
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18761/speech")!)
        request.httpMethod = "POST"; request.timeoutInterval = 35
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.setValue("dozin-live-caption", forHTTPHeaderField: "X-Caption-Room")
        request.httpBody = wav(job.samples)
        URLSession.shared.dataTask(with: request) { data, response, error in
            self.queue.async {
                self.working = false
                guard !self.stopped else { return }
                if error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
                   let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let text = result["text"] as? String {
                    let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !cleaned.isEmpty {
                        let regex = try! NSRegularExpression(pattern: "[^。！？!?\\n]+[。！？!?]*")
                        let ns = cleaned as NSString
                        for match in regex.matches(in: cleaned, range: NSRange(location: 0, length: ns.length)) {
                            let sentence = ns.substring(with: match.range).trimmingCharacters(in: .whitespacesAndNewlines)
                            if !sentence.isEmpty { self.messages.append(Caption(id: UUID().uuidString, role: "主播", text: sentence, at: job.at)) }
                        }
                        self.messages = Array(self.messages.suffix(50))
                    }
                    self.status = "capturing"
                } else { self.status = "transcription-error" }
                self.save(); self.runNext()
            }
        }.resume()
    }
    @objc func stopClicked() {
        queue.async { self.stopped = true; self.jobs.removeAll(); self.segment.removeAll(); self.status = "stopped"; self.save() }
        Task { @MainActor in try? await stream?.stopCapture(); NSApp.terminate(nil) }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
let delegate = ContinuousCaption()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
