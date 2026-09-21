// 快照版本守卫（纯函数，便于单测）：
// 基线（epoch）只由连接首包 hello 显式建立/重置；
// 之后只接受同 epoch 且 version 严格更高的快照，
// 过期/重复消息以及旧纪元残留消息一律丢弃，画面不得回滚。
export const INITIAL_BASELINE = Object.freeze({ currentEpoch: null, currentVersion: 0 });

export function judgeSnapshot(baseline, msg) {
  if (baseline.currentEpoch === null) {
    return { accept: true, baseline: true, epoch: msg.epoch, version: msg.version };
  }
  if (msg.epoch !== baseline.currentEpoch) {
    return { accept: false }; // 旧纪元（重启前）残留消息
  }
  if (msg.version <= baseline.currentVersion) {
    return { accept: false }; // 过期或重复
  }
  return { accept: true, baseline: false, epoch: msg.epoch, version: msg.version };
}

// 后台提示（cue）守卫（纯函数，便于单测）：
// 规则与快照一致——基线（epoch）只由连接首包 hello 显式建立/重置；
// 同 epoch 内只接受 cueSeq >= 已见 seq 的提示：
//   seq 更大 = 新提示，覆盖旧提示；seq 相等 = 断线重连后的同一条补发，幂等重新上屏；
//   seq 更小 = 迟到的旧提示（或旧纪元残留），一律丢弃，新提示状态不得回滚。
export const INITIAL_CUE_BASELINE = Object.freeze({ currentEpoch: null, cueSeq: 0 });

export function judgeCue(baseline, msg) {
  if (baseline.currentEpoch === null) {
    return { accept: true, fresh: true, epoch: msg.epoch, cueSeq: msg.cueSeq };
  }
  if (msg.epoch !== baseline.currentEpoch) {
    return { accept: false }; // 服务端重启前的残留提示
  }
  if (msg.cueSeq < baseline.cueSeq) {
    return { accept: false }; // 迟到的旧提示，不得覆盖新提示
  }
  return {
    accept: true,
    fresh: msg.cueSeq > baseline.cueSeq,
    epoch: msg.epoch,
    cueSeq: msg.cueSeq,
  };
}
