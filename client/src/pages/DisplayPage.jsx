import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../useSocket.js';
import { formatTime, formatClock, liveRemaining, liveAgenda } from '../time.js';
import { loadScreen, saveScreenName } from '../screen.js';

// 投屏页：展示权威计时/议程联播；收到后台提示时全屏覆盖，现场可确认。
// 屏幕身份（持久 ID + 显示名）首次打开生成，刷新沿用。
export default function DisplayPage() {
  // 仅初始化一次：WebSocket 重连时反复使用同一身份注册
  const screenRef = useRef(null);
  if (!screenRef.current) screenRef.current = loadScreen();
  const { snap, connState, cue, screenConflict, renameScreen, ackCue } =
    useSocket({ role: 'display', screenRef: screenRef.current });
  const [, force] = useState(0);

  // 100ms 重绘：对 running 快照做本地插值，保证大屏数字与议程预计时间平滑
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.title = cue
      ? `${cue.text} · 后台提示`
      : snap
        ? `${formatTime(liveRemaining(snap))} · 发言计时`
        : '发言计时投屏';
  });

  const rootClass = cue
    ? 'display display-cue-mode'
    : snap?.finished
      ? 'display display-finished'
      : snap?.warning
        ? 'display display-warning'
        : snap?.phase === 'idle'
          ? 'display display-idle'
          : 'display display-running';

  return (
    <div className={rootClass}>
      {connState !== 'open' && (
        <div className="reconnect-banner">
          {connState === 'reconnecting' ? '网络中断，正在重连并同步时间…' : '连接中…'}
        </div>
      )}

      {screenConflict && (
        <div className="screen-conflict-banner">
          此屏幕身份已被新打开的投屏页顶替，本页面不再接收提示；请关闭重复页面后刷新本页。
        </div>
      )}

      {cue ? (
        <CueOverlay cue={cue} onAck={() => ackCue(cue.cueSeq)} />
      ) : (
        <DisplayBody snap={snap} />
      )}

      <ScreenNameChip screenRef={screenRef} renameScreen={renameScreen} />
    </div>
  );
}

function DisplayBody({ snap }) {
  if (!snap) {
    return (
      <>
        <div className="display-time">--:--</div>
        <div className="display-state">等待连接…</div>
      </>
    );
  }

  const remaining = liveRemaining(snap);
  const agenda = liveAgenda(snap);
  const cur = agenda?.items.find((it) => it.status === 'current') ?? null;
  const curIdx = cur ? agenda.items.findIndex((it) => it.id === cur.id) : -1;
  const next = curIdx >= 0 ? agenda.items[curIdx + 1] ?? null : null;

  return (
    <>
      {cur && (
        <div className="display-current">
          <span className="display-current-name">{cur.name}</span>
          {cur.fixed && <span className="display-pin">📌 固定环节</span>}
          {cur.insufficient && <span className="display-short">⚠ 时间不足</span>}
        </div>
      )}

      <div className="display-phase">
        {phaseText(snap.phase)}
      </div>

      <div className="display-time">
        {snap.finished ? '00:00' : formatTime(remaining, { tenths: snap.warning && snap.phase === 'running' })}
      </div>

      <div className="display-state">
        {snap.finished
          ? '时间到'
          : snap.phase === 'idle'
            ? '待开始'
            : snap.phase === 'paused'
              ? '已暂停'
              : snap.warning
                ? '剩余不足 1 分钟'
                : '发言进行中'}
      </div>

      {next ? (
        <div className={`display-next ${next.insufficient ? 'display-next-short' : ''}`}>
          <span className="display-next-label">下一环节</span>
          <span className="display-next-name">{next.name}{next.fixed ? ' 📌' : ''}</span>
          <span className="display-next-time">预计开始 {formatClock(next.projStartMs)}</span>
        </div>
      ) : cur ? (
        <div className="display-next">
          <span className="display-next-label">本环节为最后一项</span>
        </div>
      ) : (
        <div className="display-duration">设定时长 {formatTime(snap.durationMs)}</div>
      )}
    </>
  );
}

// 后台提示全屏覆盖层：盖住计时联播，现场人员按“确认收到”后收起
function CueOverlay({ cue, onAck }) {
  const typeLabel = {
    stage: '请上场',
    hurry: '加快',
    finish: '结束',
    custom: '后台提示',
  }[cue.cueType] || '后台提示';

  return (
    <div className={`cue-overlay cue-${cue.cueType}`}>
      <div className="cue-overlay-label">{typeLabel}</div>
      <div className="cue-overlay-text">{cue.text}</div>
      <button type="button" className="cue-ack-btn" onClick={onAck}>
        ✓ 确认收到
      </button>
      <div className="cue-overlay-hint">#{cue.cueSeq} · 控制台后台提示</div>
    </div>
  );
}

// 左下角显示名设置（持久 ID 不展示全文，悬停可见）
function ScreenNameChip({ screenRef, renameScreen }) {
  const screen = screenRef.current;
  const [nameDraft, setNameDraft] = useState(screen.name);
  const [editing, setEditing] = useState(false);

  const commit = () => {
    const name = nameDraft.trim().slice(0, 20) || screen.name;
    saveScreenName(screen.id, name);
    screen.name = name;
    setNameDraft(name);
    setEditing(false);
    renameScreen(name);
  };

  return (
    <div className="display-screen-chip" title={`屏幕 ID（刷新不变）：${screen.id}`}>
      {editing ? (
        <span className="screen-name-edit">
          <input
            autoFocus
            value={nameDraft}
            maxLength={20}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setNameDraft(screen.name); setEditing(false); }
            }}
          />
          <button type="button" className="btn btn-mini btn-primary" onClick={commit}>保存</button>
          <button
            type="button"
            className="btn btn-mini"
            onClick={() => { setNameDraft(screen.name); setEditing(false); }}
          >
            取消
          </button>
        </span>
      ) : (
        <span className="screen-name-view">
          🖥 {screen.name}
          <button type="button" className="screen-name-btn" onClick={() => setEditing(true)}>
            设置显示名
          </button>
        </span>
      )}
    </div>
  );
}

function phaseText(phase) {
  return { idle: 'READY', running: 'SPEAKING', paused: 'PAUSED', finished: 'TIME UP' }[phase] || '';
}
