// 版本守卫纯函数单测：node test/guard.test.mjs
import assert from 'node:assert/strict';
import { judgeSnapshot, judgeCue, INITIAL_BASELINE, INITIAL_CUE_BASELINE } from '../client/src/guard.js';

let n = 0;
const check = (name, fn) => { fn(); n += 1; console.log(`  ✓ ${name}`); };

// 模拟连接首包 hello 建立基线
let st = { currentEpoch: 'E1', currentVersion: 0 };

check('更高版本被接受', () => {
  const v = judgeSnapshot(st, { epoch: 'E1', version: 5 });
  assert.equal(v.accept, true);
  assert.equal(v.baseline, false);
  st = { currentEpoch: v.epoch, currentVersion: v.version };
});

check('过期低版本被丢弃（不得回滚画面）', () => {
  const v = judgeSnapshot(st, { epoch: 'E1', version: 2, phase: 'idle' });
  assert.equal(v.accept, false);
});

check('相同版本被丢弃（重复消息）', () => {
  const v = judgeSnapshot(st, { epoch: 'E1', version: 5 });
  assert.equal(v.accept, false);
});

check('旧纪元残留快照（重启前消息）被丢弃', () => {
  const v = judgeSnapshot(st, { epoch: 'E0', version: 999 });
  assert.equal(v.accept, false);
});

check('未来纪元快照也不会在 hello 之前被冒认为基线', () => {
  const v = judgeSnapshot(st, { epoch: 'E2', version: 1 });
  assert.equal(v.accept, false);
});

check('INITIAL_BASELINE 下首条快照兜底接受（hello 丢失场景）', () => {
  const v = judgeSnapshot(INITIAL_BASELINE, { epoch: 'E9', version: 3 });
  assert.equal(v.accept, true);
  assert.equal(v.baseline, true);
  assert.equal(v.version, 3);
});

// ---------------- 后台提示（cue）守卫 ----------------
let cueBase = { currentEpoch: 'E1', cueSeq: 10 };

check('cue：更大 seq 为新提示，接受并标记 fresh', () => {
  const v = judgeCue(cueBase, { epoch: 'E1', cueSeq: 11 });
  assert.equal(v.accept, true);
  assert.equal(v.fresh, true);
  cueBase = { currentEpoch: v.epoch, cueSeq: v.cueSeq };
});

check('cue：相等 seq（断线重连同一条补发）接受但非 fresh（幂等上屏）', () => {
  const v = judgeCue(cueBase, { epoch: 'E1', cueSeq: 11 });
  assert.equal(v.accept, true);
  assert.equal(v.fresh, false);
});

check('cue：更小 seq 的迟到旧提示丢弃（不得覆盖新提示）', () => {
  const v = judgeCue(cueBase, { epoch: 'E1', cueSeq: 9 });
  assert.equal(v.accept, false);
});

check('cue：旧纪元残留提示丢弃', () => {
  const v = judgeCue(cueBase, { epoch: 'E0', cueSeq: 99 });
  assert.equal(v.accept, false);
});

check('cue：新纪元（服务端重启）首条在 hello 重置基线后接受', () => {
  const v = judgeCue({ currentEpoch: 'E2', cueSeq: 0 }, { epoch: 'E2', cueSeq: 1 });
  assert.equal(v.accept, true);
  assert.equal(v.fresh, true);
});

check('cue：INITIAL_CUE_BASELINE 下首条兜底接受', () => {
  const v = judgeCue(INITIAL_CUE_BASELINE, { epoch: 'E9', cueSeq: 5 });
  assert.equal(v.accept, true);
  assert.equal(v.fresh, true);
});

console.log(`\n守卫单测：${n} 通过，0 失败`);
