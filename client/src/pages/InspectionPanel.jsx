import { useEffect, useState } from 'react';

const MAX_ITEMS = 30;
const MAX_NAME_LEN = 30;
const MAX_AREA_LEN = 20;
const MAX_NOTE_LEN = 60;

const STATUS_TEXT = { pending: '待检', pass: '通过', fault: '故障' };

// 控制台“设备巡检门禁”面板：
//  - 维护巡检清单（名称 / 区域 / 必检标记，最多 30 项）：编辑模式整体保存，
//    保存即门禁失效、全部回到待检；
//  - 持有控制权者逐项登记 通过 / 故障（故障必填备注）/ 改回待检；
//  - 所有必检项均通过时门禁放行，否则顶部红条展示失效原因；
//  - 任何登记或编辑都使巡检版本 seq 递增，开始计时须携带最新 seq（服务端比对）。
export default function InspectionPanel({ inspection, canEdit, send, lastError }) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [notes, setNotes] = useState({}); // 每行故障备注输入（按巡检项 id）
  const [formError, setFormError] = useState('');

  const items = inspection?.items ?? [];

  // 权威清单变化后，为新出现的巡检项回填已固化的故障备注
  useEffect(() => {
    setNotes((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (!(it.id in next)) next[it.id] = it.note || '';
      }
      return next;
    });
  }, [inspection]);

  const report = (id, status) => {
    if (!canEdit) return;
    const note = String(notes[id] ?? '').trim().slice(0, MAX_NOTE_LEN);
    if (status === 'fault' && !note) return; // 故障必填备注（服务端同样校验）
    send({ command: 'inspect_report', id, status, note });
  };

  const startEdit = () => {
    setDrafts(items.map((it) => ({ key: it.id, name: it.name, area: it.area, required: it.required })));
    setFormError('');
    setEditing(true);
  };

  const updateDraft = (i, patch) =>
    setDrafts((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeDraft = (i) => setDrafts((rs) => rs.filter((_, j) => j !== i));
  const addDraft = () => setDrafts((rs) => (rs.length >= MAX_ITEMS ? rs : [
    ...rs,
    { key: `d-${Math.random().toString(36).slice(2, 10)}`, name: '', area: '', required: true },
  ]));

  const saveDrafts = () => {
    const out = [];
    for (let i = 0; i < drafts.length; i++) {
      const name = drafts[i].name.trim();
      const area = drafts[i].area.trim();
      if (!name) { setFormError(`第 ${i + 1} 项名称不能为空`); return; }
      if (!area) { setFormError(`第 ${i + 1} 项区域不能为空`); return; }
      out.push({ name, area, required: !!drafts[i].required });
    }
    setFormError('');
    send({ command: 'inspect_set', items: out });
    setEditing(false); // 权威 inspection 广播回来后即为最新清单（全部待检）
  };

  const inspError = lastError && (
    lastError.code === 'BAD_INSPECT' || lastError.code === 'INSPECT_LIMIT'
    || lastError.code === 'INSPECT_NOT_FOUND' || lastError.code === 'INSPECT_GATE'
    || lastError.code === 'INSPECT_STALE'
  );

  if (!inspection) {
    return (
      <fieldset className="panel" disabled>
        <legend>设备巡检门禁</legend>
        <p className="hint">正在加载巡检清单…</p>
      </fieldset>
    );
  }

  const { gateOpen, reqTotal, reqPass, invalidReason } = inspection;

  return (
    <fieldset className="panel insp-panel" disabled={!canEdit}>
      <legend>设备巡检门禁（必检项全部通过才允许开始计时，最多 {MAX_ITEMS} 项）</legend>

      <div className={`insp-gate ${gateOpen ? 'insp-gate-open' : 'insp-gate-closed'}`}>
        {gateOpen ? (
          <span>
            ✅ 门禁已放行
            {reqTotal > 0
              ? `：必检 ${reqPass}/${reqTotal} 项全部通过`
              : '（无必检项）'}
          </span>
        ) : (
          <span>⛔ 门禁未放行：{invalidReason}</span>
        )}
        {!editing && (
          <button type="button" className="btn btn-mini" onClick={startEdit}>
            ✎ 编辑清单
          </button>
        )}
      </div>

      {editing ? (
        <div className="insp-edit">
          <div className="insp-table" role="table">
            <div className="insp-row insp-head" role="row">
              <span>#</span><span>巡检项名称</span><span>区域</span><span>必检</span><span>操作</span>
            </div>
            {drafts.map((r, i) => (
              <div className="insp-row" role="row" key={r.key}>
                <span className="insp-idx">{i + 1}</span>
                <span>
                  <input
                    value={r.name}
                    maxLength={MAX_NAME_LEN}
                    placeholder={`巡检项 ${i + 1}`}
                    onChange={(e) => updateDraft(i, { name: e.target.value })}
                  />
                </span>
                <span>
                  <input
                    value={r.area}
                    maxLength={MAX_AREA_LEN}
                    placeholder="如：主席台"
                    onChange={(e) => updateDraft(i, { area: e.target.value })}
                  />
                </span>
                <span className="insp-req-cell">
                  <label title="必检项未全部通过时禁止开始计时">
                    <input
                      type="checkbox"
                      checked={!!r.required}
                      onChange={(e) => updateDraft(i, { required: e.target.checked })}
                    />
                    必检
                  </label>
                </span>
                <span className="insp-ops">
                  <button type="button" className="btn btn-mini btn-danger" onClick={() => removeDraft(i)}>删</button>
                </span>
              </div>
            ))}
            {drafts.length === 0 && <p className="hint">清单为空，请添加巡检项。</p>}
          </div>
          <div className="insp-actions">
            <button
              type="button"
              className="btn"
              onClick={addDraft}
              disabled={drafts.length >= MAX_ITEMS}
            >
              ＋ 添加巡检项（{drafts.length}/{MAX_ITEMS}）
            </button>
            <button type="button" className="btn btn-primary" onClick={saveDrafts}>
              保存清单（全部回到待检）
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
          <p className="hint">保存即视为编辑：门禁立即失效并向全场广播，所有巡检项需重新登记。</p>
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="hint">
              尚无巡检项。点“编辑清单”维护名称 / 区域 / 必检标记；
              存在必检项时，全部登记通过才允许开始计时。
            </p>
          ) : (
            <div className="insp-table" role="table">
              <div className="insp-row insp-head" role="row">
                <span>#</span><span>巡检项</span><span>区域</span><span>状态 / 故障备注</span><span>登记</span>
              </div>
              {items.map((it, i) => (
                <div
                  className={`insp-row insp-status-${it.status}`}
                  role="row"
                  key={it.id}
                >
                  <span className="insp-idx">{i + 1}</span>
                  <span className="insp-name">
                    {it.name}
                    {it.required && <em className="tag insp-tag-req">必检</em>}
                  </span>
                  <span className="insp-area">{it.area}</span>
                  <span className="insp-state">
                    <em className={`tag insp-tag-${it.status}`}>{STATUS_TEXT[it.status]}</em>
                    {it.status === 'fault' && it.note && (
                      <span className="insp-note" title={it.note}>⚠ {it.note}</span>
                    )}
                    {it.status !== 'fault' && (
                      <input
                        className="insp-note-input"
                        value={notes[it.id] ?? ''}
                        maxLength={MAX_NOTE_LEN}
                        placeholder="故障备注（登记故障时必填）"
                        onChange={(e) => setNotes((m) => ({ ...m, [it.id]: e.target.value.slice(0, MAX_NOTE_LEN) }))}
                      />
                    )}
                  </span>
                  <span className="insp-ops">
                    <button
                      type="button"
                      className="btn btn-mini insp-btn-pass"
                      disabled={it.status === 'pass'}
                      onClick={() => report(it.id, 'pass')}
                    >
                      ✓ 通过
                    </button>
                    <button
                      type="button"
                      className="btn btn-mini insp-btn-fault"
                      disabled={!String(notes[it.id] ?? '').trim() && it.status !== 'fault'}
                      title="登记故障需先在左侧填写故障备注"
                      onClick={() => report(it.id, 'fault')}
                    >
                      ✗ 故障
                    </button>
                    <button
                      type="button"
                      className="btn btn-mini"
                      disabled={it.status === 'pending'}
                      title="改回待检（必检项将立即使门禁失效）"
                      onClick={() => report(it.id, 'pending')}
                    >
                      ↺ 待检
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {(formError || inspError) && (
        <p className="agenda-error">⚠ {formError || lastError.message}</p>
      )}
      <p className="hint">
        登记与编辑仅存服务端内存并实时广播；任一必检项被改回故障 / 待检或清单被编辑，
        门禁立即失效并广播原因，重新开始计时前须再次全部通过。
      </p>
    </fieldset>
  );
}
