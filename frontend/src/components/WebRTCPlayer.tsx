import { useEffect, useRef } from 'react'
import { useHA } from '../hooks/useHA'

type WebRtcMsg =
  | { type: 'session'; session_id: string }
  | { type: 'answer'; answer: string }
  | { type: 'candidate'; candidate: string | { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
  | { type: 'error'; code?: string; message?: string }

// Player WebRTC nativo: negozia via WebSocket (camera/webrtc/offer, con fallback al
// vecchio camera/web_rtc/offer) e riceve il video peer-to-peer da go2rtc/Home Assistant
// — NON passa dal proxy dell'add-on. Su fallimento chiama onFail per ripiegare su MJPEG.
export function WebRTCPlayer({ entityId, onFail }: { entityId: string; onFail: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { subscribe, sendMessage } = useHA()

  useEffect(() => {
    let cancelled = false
    let failed = false
    let gotTrack = false
    let unsub: (() => void) | null = null

    const fail = () => { if (!cancelled && !failed) { failed = true; onFail() } }

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    const stream = new MediaStream()
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.ontrack = (ev) => {
      gotTrack = true
      stream.addTrack(ev.track)
      if (videoRef.current) videoRef.current.srcObject = stream
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') fail()
    }
    // Se entro 9s non arriva video, ripiega su MJPEG
    const watchdog = setTimeout(() => { if (!gotTrack) fail() }, 9000)

    async function startTrickle(offerSdp: string) {
      let sessionId: string | null = null
      const pending: RTCIceCandidate[] = []
      const sendCand = (sid: string, c: RTCIceCandidate) =>
        sendMessage({ type: 'camera/webrtc/candidate', entity_id: entityId, session_id: sid, candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? undefined, sdpMLineIndex: c.sdpMLineIndex ?? undefined } }).catch(() => {})
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return
        if (sessionId) sendCand(sessionId, ev.candidate)
        else pending.push(ev.candidate)
      }
      unsub = await subscribe<WebRtcMsg>(
        { type: 'camera/webrtc/offer', entity_id: entityId, offer: offerSdp },
        (msg) => {
          if (cancelled) return
          if (msg.type === 'session') {
            sessionId = msg.session_id
            for (const c of pending) sendCand(msg.session_id, c)
            pending.length = 0
          } else if (msg.type === 'answer') {
            pc.setRemoteDescription({ type: 'answer', sdp: msg.answer }).catch(fail)
          } else if (msg.type === 'candidate') {
            const c = typeof msg.candidate === 'string' ? { candidate: msg.candidate } : msg.candidate
            if (c && c.candidate) pc.addIceCandidate(c as RTCIceCandidateInit).catch(() => {})
          } else if (msg.type === 'error') {
            fail()
          }
        },
      )
    }

    async function startLegacy() {
      // API non-trickle (HA più vecchi): raccogli tutti i candidati poi invia l'offerta
      await waitIce(pc)
      const res = await sendMessage<{ answer?: string }>({ type: 'camera/web_rtc/offer', entity_id: entityId, offer: pc.localDescription?.sdp || '' })
      if (!res || !res.answer) throw new Error('no answer')
      await pc.setRemoteDescription({ type: 'answer', sdp: res.answer })
    }

    async function start() {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      try {
        await startTrickle(offer.sdp || '')
      } catch {
        if (cancelled) return
        await startLegacy()
      }
    }
    start().catch(fail)

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      try { unsub && unsub() } catch { /* noop */ }
      try { pc.close() } catch { /* noop */ }
    }
  }, [entityId])

  return <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
}

function waitIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve() }
    const check = () => { if (pc.iceGatheringState === 'complete') done() }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(done, 3000)
  })
}
