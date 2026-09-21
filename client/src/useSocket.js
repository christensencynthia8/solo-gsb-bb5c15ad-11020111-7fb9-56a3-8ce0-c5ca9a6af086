import { useCallback, useEffect, useRef, useState } from 'react';
import { monoNow } from './time.js';
import { judgeSnapshot, judgeCue, INITIAL_BASELINE, INITIAL_CUE_BASELINE } from './guard.js';

// 单一 WebSocket 连接管理：
//  - 自动重连（指数退避，上限 5s）；
//  - 快照版本守卫：低版本 / 旧纪元（服务端重启前）消息一律丢弃，画面不回滚；
//  - 提示（cue）守卫：旧 cueSeq / 旧纪元提示一律丢弃，新提示覆盖旧提示；
//  - 控制台心跳续租，断线自动重新申请控制权；
//  - 投屏每次连接/重连用持久屏幕 ID 注册，重连后补发未确认最新提示。
const HEARTBEAT_MS = 5000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5000;

export function useSocket({ role, screenRef }) {
  const [snap, setSnap] = useState(null);
  const [screens, setScreens] = useState([]);          // 控制台：所有投屏及最新提示状态
  const [markers, setMarkers] = useState([]);          // 控制台：本场会话现场标记（投屏收不到更新）
  const [markerMeta, setMarkerMeta] = useState(null);  // { sessionId } 本场会话信息
  const [inspection, setInspection] = useState(null);  // 控制台：设备巡检门禁状态（投屏收不到更新）
  const [gateEvent, setGateEvent] = useState(null);    // 门禁放行/失效翻转事件（含原因），供横幅提示
  const [cue, setCue] = useState(null);                // 投屏：当前上屏的提示
  const [screenConflict, setScreenConflict] = useState(false); // 投屏：同一 ID 被新连接顶替
  const [connState, setConnState] = useState('connecting'); // connecting | open | reconnecting
  const [control, setControl] = useState({ granted: false });
  const [lastError, setLastError] = useState(null);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const wantControlRef = useRef(role === 'console'); // 控制台始终希望持有控制权
  const myIdRef = useRef(null);
  const baselineRef = useRef({ ...INITIAL_BASELINE });
  const cueBaselineRef = useRef({ ...INITIAL_CUE_BASELINE });
  const reportedCueRef = useRef(0); // 已上报“已显示”的 cueSeq（同一条补发不重复上报）
  const screenRefRef = useRef(screenRef);
  screenRefRef.current = screenRef;

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const acquire = useCallback(() => {
    wantControlRef.current = true;
    send({ command: 'acquire' });
  }, [send]);

  const release = useCallback(() => {
    wantControlRef.current = false;
    send({ command: 'release' });
    setControl({ granted: false });
  }, [send]);

  const clearError = useCallback(() => setLastError(null), []);

  // 投屏修改显示名：持久化后重发注册（服务端立即改名并广播）
  const renameScreen = useCallback((name) => {
    const sid = screenRefRef.current;
    if (!sid) return;
    send({ command: 'screen_rename', screenId: sid.id, name });
  }, [send]);

  // 投屏人工确认当前提示：本地立即收起覆盖层（确认随后随名单对账），
  // 迟到的旧提示不会重新弹出——守卫只认 cueSeq 更高/相等。
  const ackCue = useCallback((cueSeq) => {
    const sid = screenRefRef.current;
    if (!sid) return;
    send({ command: 'cue_ack', screenId: sid.id, cueSeq });
    setCue((cur) => (cur && cur.cueSeq === cueSeq ? null : cur));
  }, [send]);

  useEffect(() => {
    let disposed = false;
    let heartbeatTimer = null;

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        retryRef.current = 0;
        setConnState('open');
        // 投屏：每次连接都用持久屏幕 ID 注册；重连后服务端补发未确认最新提示
        if (role === 'display' && screenRefRef.current) {
          const sid = screenRefRef.current;
          ws.send(JSON.stringify({
            command: 'screen_register',
            screenId: sid.id,
            name: sid.name,
          }));
        }
        // 重连后旧租约已被服务端释放，若之前持有/需要控制权则重新申请；
        // 仅控制台续租，投屏不发心跳（避免无意义的 NOT_CONTROLLER 错误）。
        if (role === 'console') {
          if (wantControlRef.current) ws.send(JSON.stringify({ command: 'acquire' }));
          heartbeatTimer = setInterval(() => {
            ws.send(JSON.stringify({ command: 'heartbeat' }));
          }, HEARTBEAT_MS);
        }
      });

      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        if (msg.type === 'hello') {
          myIdRef.current = msg.clientId;
          // 连接/重连首包显式建立纪元基线；服务端重启后 epoch 变化，重置版本号
          baselineRef.current = { currentEpoch: msg.epoch, currentVersion: 0 };
          cueBaselineRef.current = { currentEpoch: msg.epoch, cueSeq: 0 };
          reportedCueRef.current = 0;
          // 新纪元：丢弃上一纪元残留的门禁横幅（权威状态随 inspection 首包重建）
          setGateEvent(null);
          return;
        }

        if (msg.type === 'snapshot') {
          // 版本守卫：过期/重复/旧纪元消息一律丢弃，画面不得回滚
          const verdict = judgeSnapshot(baselineRef.current, msg);
          if (!verdict.accept) return;
          baselineRef.current = { currentEpoch: verdict.epoch, currentVersion: verdict.version };
          setSnap({ ...msg, receivedAtMono: monoNow() });

          // 控制权归属对账（可能被其他控制台顶掉/超时释放）
          const mine = msg.holderId != null && msg.holderId === myIdRef.current;
          setControl((prev) => {
            if (prev.granted === mine && prev.holderId === msg.holderId) return prev;
            return mine
              ? { granted: true, holderId: msg.holderId }
              : { granted: false, holderId: msg.holderId, locked: msg.locked };
          });
          return;
        }

        if (msg.type === 'screens') {
          // 屏幕名单（含每屏最新提示与状态）由服务端权威整体替换
          setScreens(Array.isArray(msg.screens) ? msg.screens : []);
          return;
        }

        if (msg.type === 'markers') {
          // 现场标记由服务端权威整体替换；旧纪元（重启前）残留消息丢弃，列表不回滚
          if (baselineRef.current.currentEpoch !== null && msg.epoch !== baselineRef.current.currentEpoch) {
            return;
          }
          setMarkerMeta({ sessionId: msg.sessionId });
          setMarkers(Array.isArray(msg.markers) ? msg.markers : []);
          return;
        }

        if (msg.type === 'inspection') {
          // 巡检清单/门禁状态由服务端权威整体替换；旧纪元残留消息丢弃
          if (baselineRef.current.currentEpoch !== null && msg.epoch !== baselineRef.current.currentEpoch) {
            return;
          }
          setInspection({
            seq: msg.seq,
            armedSeq: msg.armedSeq,
            gate: msg.gate,
            items: Array.isArray(msg.items) ? msg.items : [],
          });
          return;
        }

        if (msg.type === 'inspection_gate') {
          // 门禁翻转（放行↔失效）广播：失效时带原因，供控制台横幅即时提示
          if (baselineRef.current.currentEpoch !== null && msg.epoch !== baselineRef.current.currentEpoch) {
            return;
          }
          setGateEvent({
            atMono: monoNow(),
            armed: !!msg.armed,
            reason: msg.reason ?? null,
            reasonText: msg.reasonText ?? '',
            gate: msg.gate ?? null,
            seq: msg.seq,
          });
          return;
        }

        if (msg.type === 'cue' && role === 'display') {
          // 提示守卫：旧纪元 / 更小 cueSeq 的迟到消息一律丢弃；
          // cueSeq 相等为重连同一条补发（幂等），更大为新提示（覆盖）。
          const verdict = judgeCue(cueBaselineRef.current, msg);
          if (!verdict.accept) return;
          cueBaselineRef.current = { currentEpoch: verdict.epoch, cueSeq: verdict.cueSeq };
          const sid = screenRefRef.current;
          const nextCue = { cueSeq: msg.cueSeq, cueType: msg.cueType, text: msg.text };
          setCue(nextCue);
          setScreenConflict(false);
          // 新提示（或重启纪元后的首条）通知服务端“已上屏”；同一条补发不重复上报
          if (verdict.fresh || reportedCueRef.current !== msg.cueSeq) {
            reportedCueRef.current = msg.cueSeq;
            send({ command: 'cue_displayed', screenId: sid?.id, cueSeq: msg.cueSeq });
          }
          return;
        }

        if (msg.type === 'screen_hello' && role === 'display') {
          // 注册/改名确认：服务端规范化后的显示名回填本地身份
          if (msg.screen && screenRefRef.current?.id === msg.screen.id) {
            screenRefRef.current.name = msg.screen.name;
            setScreens((prev) => (prev.length ? prev : [msg.screen]));
          }
          return;
        }

        if (msg.type === 'screen_conflict' && role === 'display') {
          // 同一持久屏幕 ID 被更新的连接注册（通常是本屏页面被顶替）：
          // 本连接不再代表该屏，提示用户且不再上屏/确认，避免双屏互相打架。
          setScreenConflict(true);
          return;
        }

        if (msg.type === 'control') {
          // 控制权消息为单播；targetId 存在时仅当事连接处理
          if (msg.targetId && msg.targetId !== myIdRef.current) return;
          if (msg.granted) {
            setControl({ granted: true, holderId: myIdRef.current });
          } else {
            // 被拒绝 / 释放 / 断线 / 超时，本端失去控制权
            setControl({
              granted: false,
              reason: msg.reason,
              holderId: msg.holderId ?? null,
              locked: msg.reason === 'locked',
            });
          }
          return;
        }

        if (msg.type === 'error') {
          // 服务端指令错误（如 BAD_AGENDA / NOT_CONTROLLER），供控制台提示
          setLastError({ code: msg.code, message: msg.message || msg.code });
        }
      });

      ws.addEventListener('close', () => {
        clearInterval(heartbeatTimer);
        if (disposed) return;
        setConnState('reconnecting');
        setControl((prev) => (prev.granted ? { ...prev, granted: false, reason: 'reconnect' } : prev));
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryRef.current);
        retryRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    };

    connect();

    return () => {
      disposed = true;
      clearInterval(heartbeatTimer);
      clearTimeout(reconnectTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        // 正常卸载：通知服务端释放租约（投屏无需额外注销，close 即标记离线）
        if (role === 'console' && wantControlRef.current && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ command: 'release' }));
        }
        ws.close();
      }
    };
  }, [role, send]);

  return {
    snap,
    screens,
    markers,
    markerMeta,
    inspection,
    gateEvent,
    cue,
    screenConflict,
    connState,
    control,
    lastError,
    send,
    acquire,
    release,
    renameScreen,
    ackCue,
    clearError,
  };
}
