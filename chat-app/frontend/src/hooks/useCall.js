import { useCallback, useEffect, useRef, useState } from 'react';

// LAN обойдётся host-кандидатами; STUN — запаска на случай сегментации сети
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Машина состояний звонка 1:1.
 * idle → outgoing (гудки) → active
 * idle → incoming (входящий)  → active
 * Финальные: ended/declined/missed/cancelled — возвращают в idle.
 *
 * Сигналинг: call_invite/call_accept + rtc_relay ↔ rtc_signal.
 */
export default function useCall({ socket, currentUser, onNotice }) {
  const [call, setCall] = useState(null);
  // { phase: 'incoming'|'outgoing'|'active', callId, peer:{id,username,avatar}, type,
  //   micMuted, camOff, sharing, startedAt }
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const pcRef = useRef(null);
  const localRef = useRef(null);          // MediaStream
  const camTrackRef = useRef(null);       // исходная камера (до шаринга экрана)
  const peerRef = useRef(null);           // собеседник
  const typeRef = useRef('audio');
  const callIdRef = useRef(null);
  const phaseRef = useRef(null);
  const remoteRef = useRef(null);         // MediaStream

  const canCall = typeof window !== 'undefined'
    && !!window.isSecureContext
    && typeof window.RTCPeerConnection !== 'undefined';

  // ── утилиты ──
  const relay = useCallback((toUserId, payload) => {
    socket?.emit('rtc_relay', { toUserId, payload });
  }, [socket]);

  const ensureMedia = useCallback(async () => {
    if (localRef.current) return localRef.current;
    const constraints = {
      audio: true,
      video: typeRef.current === 'video' ? { width: { ideal: 1280 } } : false
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localRef.current = stream;
    camTrackRef.current = stream.getVideoTracks()[0] || null;
    setLocalStream(stream);
    return stream;
  }, []);

  const ensurePC = useCallback(() => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    localRef.current?.getTracks().forEach(t => pc.addTrack(t, localRef.current));
    pc.onicecandidate = (e) => {
      if (e.candidate && callIdRef.current && peerRef.current) {
        relay(peerRef.current.id, {
          callId: callIdRef.current, kind: 'ice',
          candidate: e.candidate.toJSON()
        });
      }
    };
    pc.ontrack = (e) => {
      remoteRef.current = remoteRef.current || new MediaStream();
      e.streams[0]?.getTracks().forEach(t => { if (!remoteRef.current.getTracks().includes(t)) remoteRef.current.addTrack(t); });
      setRemoteStream(remoteRef.current);
    };
    pcRef.current = pc;
    return pc;
  }, [relay]);

  const resetAll = useCallback(() => {
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    localRef.current?.getTracks().forEach(t => t.stop());
    localRef.current = null; camTrackRef.current = null;
    remoteRef.current = null;
    callIdRef.current = null; peerRef.current = null; phaseRef.current = null;
    setLocalStream(null); setRemoteStream(null);
    setCall(null);
  }, []);

  const stopSharingIfAny = useCallback(async () => {
    const pc = pcRef.current;
    const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
    if (camTrackRef.current && sender) {
      await sender.replaceTrack(camTrackRef.current);
      camTrackRef.current.stop && null; // камера не остановлена — возвращаем её
      const ls = localRef.current;
      if (ls) {
        ls.removeTracks ? null : null;
      }
    }
  }, []);

  // ── публичные действия ──

  const startCall = useCallback(async (peerUser, type = 'audio') => {
    if (!canCall) {
      onNotice?.('Звонки доступны только по HTTPS (безопасный контекст)');
      return;
    }
    if (!socket || !currentUser || call) return;

    typeRef.current = type;
    peerRef.current = peerUser;
    setCall({
      phase: 'outgoing', callId: null,
      peer: { id: peerUser.id, username: peerUser.username, avatar: peerUser.avatar },
      type, micMuted: false, camOff: false, sharing: false, startedAt: null
    });

    socket.emit('call_invite', { targetUserId: peerUser.id, callType: type },
      (res) => {
        if (!res || !res.ok) {
          const msg = res?.reason === 'peer_busy' ? 'У пользователя сейчас другой звонок'
            : res?.reason === 'you_busy' ? 'Вы уже в звонке'
            : 'Не удалось начать звонок';
          onNotice?.(msg);
          resetAll();
          return;
        }
        callIdRef.current = res.callId;
        setCall(prev => prev ? { ...prev, callId: res.callId } : prev);
      });
  }, [canCall, socket, currentUser, call, onNotice, resetAll]);

  const acceptIncoming = useCallback(async () => {
    const c = call;
    if (!c || c.phase !== 'incoming') return;
    try {
      await ensureMedia();
      ensurePC();
      callIdRef.current = c.callId;
      phaseRef.current = 'active';
      socket.emit('call_accept', { callId: c.callId });
      setCall(prev => ({ ...prev, phase: 'active', startedAt: Date.now() }));
    } catch (e) {
      onNotice?.('Нет доступа к камере/микрофону: ' + e.message);
      socket.emit('call_decline', { callId: c.callId });
      resetAll();
    }
  }, [call, ensureMedia, ensurePC, socket, onNotice, resetAll]);

  const declineIncoming = useCallback(() => {
    if (!call) return;
    socket.emit('call_decline', { callId: call.callId });
    resetAll();
  }, [call, socket, resetAll]);

  const cancelOutgoing = useCallback(() => {
    if (!call) return;
    socket.emit('call_cancel', { callId: call.callId });
    resetAll();
  }, [call, socket, resetAll]);

  const hangup = useCallback(() => {
    if (!call) return;
    socket.emit('call_hangup', { callId: call.callId });
    resetAll();
  }, [call, socket, resetAll]);

  const toggleMic = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall(prev => prev ? { ...prev, micMuted: !track.enabled } : prev);
  }, []);

  const toggleCam = useCallback(async () => {
    const track = localRef.current?.getVideoTracks()[0]
      || camTrackRef.current;
    if (!track) { onNotice?.('Видео недоступно в аудиозвонке'); return; }
    track.enabled = !track.enabled;
    setCall(prev => prev ? { ...prev, camOff: !track.enabled } : prev);
  }, [onNotice]);

  const toggleShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const sharingNow = call?.sharing;
    try {
      if (!sharingNow) {
        const disp = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = disp.getVideoTracks()[0];
        screenTrack.onended = () => { /* пользователь завершил шаринг системной кнопкой */ };
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          || pc.addTrack(screenTrack, localRef.current);
        await sender.replaceTrack(screenTrack);
        setCall(prev => prev ? { ...prev, sharing: true } : prev);
      } else {
        await stopSharingIfAny();
        setCall(prev => prev ? { ...prev, sharing: false } : prev);
      }
    } catch (e) {
      onNotice?.('Шаринг экрана отменён');
      setCall(prev => prev ? { ...prev, sharing: false } : prev);
    }
  }, [call, stopSharingIfAny, onNotice]);

  // ── сокет-события ──
  useEffect(() => {
    if (!socket) return;

    const onIncoming = ({ callId, callType, from }) => {
      if (phaseRef.current) return; // уже в звонке — сервер не даст второй, страховка
      typeRef.current = callType || 'audio';
      peerRef.current = from;
      callIdRef.current = callId;
      phaseRef.current = 'incoming';
      setCall({
        phase: 'incoming', callId, type: callType || 'audio', peer: from,
        micMuted: false, camOff: false, sharing: false, startedAt: null
      });
    };

    const onAccepted = async ({ callId }) => {
      if (phaseRef.current !== 'outgoing' || callIdRef.current !== callId) return;
      try {
        await ensureMedia();
        const pc = ensurePC();
        phaseRef.current = 'active';
        setCall(prev => prev ? { ...prev, phase: 'active', startedAt: Date.now() } : prev);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        relay(peerRef.current.id, { callId, kind: 'offer', sdp: pc.localDescription });
      } catch (e) {
        onNotice?.('Ошибка микрофона/камеры: ' + e.message);
        socket.emit('call_cancel', { callId });
        resetAll();
      }
    };

    const onDeclined = ({ callId }) => {
      if (callIdRef.current !== callId) return;
      onNotice?.('Звонок отклонён');
      resetAll();
    };
    const onMissedOrCancelled = ({ callId }) => {
      if (callIdRef.current !== callId) return;
      onNotice?.('Звонок прерван');
      resetAll();
    };
    const onEnded = ({ callId }) => {
      if (callIdRef.current !== callId) return;
      onNotice?.('Звонок завершён');
      resetAll();
    };

    const onSignal = async ({ fromUserId, payload }) => {
      if (!payload || callIdRef.current !== payload.callId) return;
      const pc = ensurePC();
      try {
        if (payload.kind === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          relay(fromUserId, { callId: payload.callId, kind: 'answer', sdp: pc.localDescription });
        } else if (payload.kind === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          }
        } else if (payload.kind === 'ice') {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
        }
      } catch (e) {
        console.error('rtc_signal:', e.message);
      }
    };

    socket.on('call_incoming', onIncoming);
    socket.on('call_accepted', onAccepted);
    socket.on('call_declined', onDeclined);
    socket.on('call_missed', onMissedOrCancelled);
    socket.on('call_cancelled', onMissedOrCancelled);
    socket.on('call_ended', onEnded);
    socket.on('rtc_signal', onSignal);

    return () => {
      socket.off('call_incoming', onIncoming);
      socket.off('call_accepted', onAccepted);
      socket.off('call_declined', onDeclined);
      socket.off('call_missed', onMissedOrCancelled);
      socket.off('call_cancelled', onMissedOrCancelled);
      socket.off('call_ended', onEnded);
      socket.off('rtc_signal', onSignal);
    };
  }, [socket, ensureMedia, ensurePC, relay, onNotice, resetAll]);

  // Разрыв сокета = конец звонка
  useEffect(() => {
    if (!socket && call) resetAll();
  }, [socket, call, resetAll]);

  return {
    call, localStream, remoteStream, canCall,
    startCall, acceptIncoming, declineIncoming, cancelOutgoing, hangup,
    toggleMic, toggleCam, toggleShare
  };
}
