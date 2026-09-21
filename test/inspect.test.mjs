// 设备巡检门禁（inspection gate）集成测试：启动独立服务实例（独立端口），验证：
//  1. 初始首包带空清单且门禁放行；无必检项时 start 不需要巡检版本（向后兼容）；
//  2. 非持有者不能编辑清单/登记；清单校验（>30 项、空名称/区域、超长）；
//  3. 编辑清单即门禁失效并广播原因；必检项未全通过时 start 被拒（INSPECT_GATE）；
//  4. 全部必检通过后门禁放行；start 必须携带当前巡检版本 seq（否则 INSPECT_STALE）；
//  5. 必检项被改回故障（必填备注）/待检立即使门禁失效并广播原因；普通项不影响；
//  6. 运行中的计时不受门禁影响（门禁只拦截“开始”）；重连首包恢复完整清单状态。
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = process.env.TEST_INSPECT_PORT || 3499;
const URL = `ws://localhost:${PORT}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const inbox = [];
    ws.on('open', () => resolve({ ws, inbox }));
    ws.on('error', reject);
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  });
}
async function next(inbox, type, pred, timeout = 3000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const i = inbox.findIndex((m) => m.type === type && (!pred || pred(m)));
    if (i >= 0) return inbox.splice(i, 1)[0];
    if (Date.now() > deadline) throw new Error(`等待 ${type} 超时`);
    await sleep(20);
  }
}
const nextInspection = (inbox, pred, timeout = 3000) => next(inbox, 'inspection', pred, timeout);
async function drain(inbox, ms = 300) {
  await sleep(ms);
  return inbox.splice(0);
}
async function waitSnapshot(inbox, pred, timeout = 8000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    await sleep(50);
    const snaps = inbox.filter((m) => m.type === 'snapshot');
    if (snaps.some(pred)) return snaps.filter(pred).pop();
    inbox.length = 0;
    if (Date.now() > deadline) return null;
  }
}

const child = spawn(process.execPath, ['server/src/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

try {
  for (let i = 0; i < 50; i++) {
    try { await connect().then((x) => x.ws.close()); break; } catch { await sleep(100); }
  }

  console.log('1) 初始首包：空清单、门禁放行、无必检项时 start 兼容旧协议');
  const con = await connect();
  await next(con.inbox, 'hello');
  await next(con.inbox, 'snapshot');
  const init = await nextInspection(con.inbox);
  ok('初始清单为空且门禁放行',
    Array.isArray(init.items) && init.items.length === 0
      && init.gateOpen === true && init.reqTotal === 0 && init.reqPass === 0
      && init.invalidReason === null && Number.isInteger(init.seq));
  con.ws.send(JSON.stringify({ command: 'acquire' }));
  await next(con.inbox, 'control');
  await drain(con.inbox, 100);
  // 无必检项：旧式 start（不带 inspectSeq）仍可开始（向后兼容）
  con.ws.send(JSON.stringify({ command: 'set_duration', durationMs: 60000 }));
  await waitSnapshot(con.inbox, (m) => m.durationMs === 60000);
  con.ws.send(JSON.stringify({ command: 'start' }));
  const sRun0 = await waitSnapshot(con.inbox, (m) => m.phase === 'running');
  ok('无必检项时不带 inspectSeq 也可开始', !!sRun0);
  con.ws.send(JSON.stringify({ command: 'reset' }));
  await waitSnapshot(con.inbox, (m) => m.phase === 'idle');

  console.log('2) 非持有者不能编辑清单 / 登记');
  const other = await connect();
  await next(other.inbox, 'hello');
  await next(other.inbox, 'snapshot');
  await nextInspection(other.inbox);
  other.ws.send(JSON.stringify({ command: 'inspect_set', items: [] }));
  const errSet = await next(other.inbox, 'error');
  ok('非持有者 inspect_set 返回 NOT_CONTROLLER', errSet.code === 'NOT_CONTROLLER', errSet.code);
  other.ws.send(JSON.stringify({ command: 'inspect_report', id: 'i-x', status: 'pass' }));
  const errRep = await next(other.inbox, 'error');
  ok('非持有者 inspect_report 返回 NOT_CONTROLLER', errRep.code === 'NOT_CONTROLLER', errRep.code);
  other.ws.close();

  console.log('3) 清单校验：超限 / 空名称 / 空区域 / 超长均被拒');
  con.ws.send(JSON.stringify({
    command: 'inspect_set',
    items: Array.from({ length: 31 }, (_, i) => ({ name: `项${i}`, area: 'A区', required: false })),
  }));
  const errLimit = await next(con.inbox, 'error');
  ok('超过 30 项返回 INSPECT_LIMIT', errLimit.code === 'INSPECT_LIMIT', errLimit.code);
  con.ws.send(JSON.stringify({ command: 'inspect_set', items: [{ name: '  ', area: 'A区' }] }));
  const errName = await next(con.inbox, 'error');
  ok('空名称返回 BAD_INSPECT', errName.code === 'BAD_INSPECT', errName.code);
  con.ws.send(JSON.stringify({ command: 'inspect_set', items: [{ name: '音响', area: '' }] }));
  const errArea = await next(con.inbox, 'error');
  ok('空区域返回 BAD_INSPECT', errArea.code === 'BAD_INSPECT', errArea.code);
  con.ws.send(JSON.stringify({ command: 'inspect_set', items: [{ name: '字'.repeat(31), area: 'A区' }] }));
  const errLong = await next(con.inbox, 'error');
  ok('名称超 30 字返回 BAD_INSPECT', errLong.code === 'BAD_INSPECT', errLong.code);
  await drain(con.inbox, 100);
  ok('校验失败不产生 inspection 广播', con.inbox.filter((m) => m.type === 'inspection').length === 0);

  console.log('4) 编辑清单：门禁立即失效并广播原因，start 被拒');
  con.ws.send(JSON.stringify({
    command: 'inspect_set',
    items: [
      { name: '主扩音响', area: '主席台', required: true },
      { name: '投影幕布', area: '舞台两侧', required: false },
    ],
  }));
  const insp1 = await nextInspection(con.inbox, (m) => m.items.length === 2);
  ok('清单两项且全部待检',
    insp1.items.every((it) => it.status === 'pending' && it.note === '')
      && insp1.items[0].required === true && insp1.items[1].required === false);
  ok('门禁失效且原因说明清单已编辑',
    insp1.gateOpen === false && /已编辑/.test(insp1.invalidReason), insp1.invalidReason);
  ok('必检进度 0/1', insp1.reqTotal === 1 && insp1.reqPass === 0);
  const seq1 = insp1.seq;
  ok('编辑后巡检版本递增', seq1 > init.seq, `${seq1} vs ${init.seq}`);
  con.ws.send(JSON.stringify({ command: 'start', inspectSeq: seq1 }));
  const errGate = await next(con.inbox, 'error');
  ok('必检未通过时 start 返回 INSPECT_GATE', errGate.code === 'INSPECT_GATE', errGate.code);
  ok('错误消息带失效原因', errGate.message.includes(insp1.invalidReason), errGate.message);

  console.log('5) 登记校验：故障必填备注；未知巡检项；非法状态');
  const idReq = insp1.items[0].id;
  const idOpt = insp1.items[1].id;
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idReq, status: 'fault' }));
  const errNote = await next(con.inbox, 'error');
  ok('故障无备注返回 BAD_INSPECT', errNote.code === 'BAD_INSPECT', errNote.code);
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: 'i-nope', status: 'pass' }));
  const errNF = await next(con.inbox, 'error');
  ok('未知巡检项返回 INSPECT_NOT_FOUND', errNF.code === 'INSPECT_NOT_FOUND', errNF.code);
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idReq, status: 'broken' }));
  const errSt = await next(con.inbox, 'error');
  ok('非法状态返回 BAD_INSPECT', errSt.code === 'BAD_INSPECT', errSt.code);

  console.log('6) 必检项登记通过后门禁放行；start 需携带最新巡检版本');
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idReq, status: 'pass' }));
  const insp2 = await nextInspection(con.inbox, (m) => m.gateOpen === true);
  ok('必检通过后门禁放行（普通项待检不影响）',
    insp2.reqPass === 1 && insp2.reqTotal === 1 && insp2.invalidReason === null);
  const seq2 = insp2.seq;
  ok('登记使版本递增', seq2 > seq1, `${seq2} vs ${seq1}`);
  // 不带版本 → 拒绝
  con.ws.send(JSON.stringify({ command: 'start' }));
  const errStale0 = await next(con.inbox, 'error');
  ok('有必检项时不带 inspectSeq 返回 INSPECT_STALE', errStale0.code === 'INSPECT_STALE', errStale0.code);
  // 旧版本 → 拒绝
  con.ws.send(JSON.stringify({ command: 'start', inspectSeq: seq1 }));
  const errStale1 = await next(con.inbox, 'error');
  ok('过期 inspectSeq 返回 INSPECT_STALE', errStale1.code === 'INSPECT_STALE', errStale1.code);
  // 当前版本 → 放行
  con.ws.send(JSON.stringify({ command: 'start', inspectSeq: seq2 }));
  const sRun = await waitSnapshot(con.inbox, (m) => m.phase === 'running');
  ok('携带当前巡检版本开始成功', !!sRun);

  console.log('7) 运行中必检项改回故障：门禁立即失效广播原因，计时不受影响');
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idReq, status: 'fault', note: '无声音输出' }));
  const insp3 = await nextInspection(con.inbox, (m) => m.gateOpen === false);
  ok('门禁立即失效且原因含项名与故障备注',
    /主扩音响/.test(insp3.invalidReason) && /无声音输出/.test(insp3.invalidReason),
    insp3.invalidReason);
  ok('故障备注固化在清单中',
    insp3.items.find((it) => it.id === idReq).note === '无声音输出');
  const stillRun = await waitSnapshot(con.inbox, (m) => m.phase === 'running');
  ok('运行中的计时不被门禁打断', !!stillRun);
  con.ws.send(JSON.stringify({ command: 'reset' }));
  await waitSnapshot(con.inbox, (m) => m.phase === 'idle');
  con.ws.send(JSON.stringify({ command: 'start', inspectSeq: insp3.seq }));
  const errGate2 = await next(con.inbox, 'error');
  ok('故障状态下 start 再被拒（INSPECT_GATE）', errGate2.code === 'INSPECT_GATE', errGate2.code);

  console.log('8) 改回待检同样使门禁失效并广播原因');
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idReq, status: 'pass' }));
  await nextInspection(con.inbox, (m) => m.gateOpen === true);
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idReq, status: 'pending' }));
  const insp4 = await nextInspection(con.inbox, (m) => m.gateOpen === false);
  ok('改回待检后门禁失效且原因指明该项', /主扩音响/.test(insp4.invalidReason) && /待检/.test(insp4.invalidReason),
    insp4.invalidReason);

  console.log('9) 普通（非必检）项登记故障不影响门禁');
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idReq, status: 'pass' }));
  await nextInspection(con.inbox, (m) => m.gateOpen === true);
  con.ws.send(JSON.stringify({ command: 'inspect_report', id: idOpt, status: 'fault', note: '左侧幕布卡顿' }));
  const insp5 = await nextInspection(con.inbox, (m) => m.items.find((it) => it.id === idOpt).status === 'fault');
  ok('普通项故障后门禁仍放行', insp5.gateOpen === true && insp5.invalidReason === null);

  console.log('10) 再次编辑清单：门禁立即失效、版本变化、状态全部重置');
  con.ws.send(JSON.stringify({
    command: 'inspect_set',
    items: [{ name: '备用话筒', area: '控制室', required: true }],
  }));
  const insp6 = await nextInspection(con.inbox, (m) => m.items.length === 1);
  ok('编辑后门禁失效且原因说明已编辑',
    insp6.gateOpen === false && /已编辑/.test(insp6.invalidReason), insp6.invalidReason);
  ok('清单被整体替换且回到待检',
    insp6.items[0].name === '备用话筒' && insp6.items[0].status === 'pending');
  ok('版本继续递增', insp6.seq > insp5.seq, `${insp6.seq} vs ${insp5.seq}`);

  console.log('11) 重连首包恢复完整巡检状态');
  const con2 = await connect();
  await next(con2.inbox, 'hello');
  await next(con2.inbox, 'snapshot');
  const recon = await nextInspection(con2.inbox);
  ok('重连后清单/版本/门禁状态一致',
    recon.seq === insp6.seq && recon.gateOpen === false
      && recon.items.length === 1 && recon.items[0].name === '备用话筒'
      && recon.items[0].required === true && recon.items[0].status === 'pending');
  con2.ws.close();

  console.log('12) 清空清单：无必检项，门禁恢复放行');
  con.ws.send(JSON.stringify({ command: 'inspect_set', items: [] }));
  const insp7 = await nextInspection(con.inbox, (m) => m.items.length === 0);
  ok('清空后门禁放行', insp7.gateOpen === true && insp7.reqTotal === 0);
  con.ws.send(JSON.stringify({ command: 'start' }));
  const sRun2 = await waitSnapshot(con.inbox, (m) => m.phase === 'running');
  ok('清空后旧式 start 立即可用', !!sRun2);

  try { con.ws.close(); } catch {}

  console.log(`\n设备巡检门禁测试：${passed} 通过，${failures.length} 失败`);
  if (failures.length) {
    console.log('失败项:', failures.join('; '));
    process.exitCode = 1;
  }
} catch (e) {
  console.error('  ✗ 测试异常:', e);
  process.exitCode = 1;
} finally {
  child.kill();
}
