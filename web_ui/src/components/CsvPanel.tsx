import { store } from "../sim/store";

export function CsvPanel() {
  const exportCsv = () => {
    const buf = store.getBuffer();
    if (buf.length === 0) return;
    const head = "t_s,rpm,torque_Nm,load_Nm,iq_A,ia_A,ib_A,ic_A,dutyA,dutyB,dutyC\n";
    const rows = buf
      .map(
        (s) =>
          `${s.t.toFixed(6)},${s.rpm.toFixed(3)},${s.torque.toFixed(5)},${s.load.toFixed(5)},` +
          `${s.iq.toFixed(4)},${s.ia.toFixed(4)},${s.ib.toFixed(4)},${s.ic.toFixed(4)},` +
          `${s.dA.toFixed(4)},${s.dB.toFixed(4)},${s.dC.toFixed(4)}`
      )
      .join("\n");
    const blob = new Blob([head + rows + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `motorforge_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bufferLen = store.getBuffer().length;

  return (
    <div className="panel">
      <div className="panel-title"><span className="tag">CSV</span>数据记录</div>
      <div className="btn-row">
        <button className="btn" onClick={exportCsv} disabled={bufferLen === 0}>
          导出 CSV ({bufferLen} 帧)
        </button>
        <button
          className="btn"
          onClick={() => store.reset()}
          disabled={bufferLen === 0}
        >
          清空缓冲区
        </button>
      </div>
      <div className="hint">缓冲区持续滚动记录仿真状态（环形，~12s@50Hz），数据全部来自仿真快照，无客户端合成。</div>
    </div>
  );
}
