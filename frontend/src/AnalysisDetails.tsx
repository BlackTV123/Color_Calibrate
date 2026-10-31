import './analysis-details.css';

export interface MeasuredColour {
  name: string;
  hex: string;
  rgb: number[];
  percent: number;
  scale_match: string;
  de00: number | null;
}

type Channels = { r: number[]; g: number[]; b: number[] };
type Histogram = { bins: number[]; raw: Channels; cal: Channels };
interface DetailResult {
  has_wound: boolean;
  measured_colours?: { skin: MeasuredColour[]; wound: MeasuredColour[] };
  wound_size?: { status: string; width_cm?: number | null; length_cm?: number | null; area_cm2?: number | null; note?: string };
  histograms?: { skin?: Histogram; wound?: Histogram };
}
const number = (value: number | null | undefined, digits = 1) =>
  value != null && Number.isFinite(value) ? value.toFixed(digits) : '—';

function Colours({ title, rows, empty }: { title: string; rows?: MeasuredColour[]; empty: string }) {
  const complete = rows?.length && rows.every(row => row.name && row.rgb?.length === 3 && row.percent > 0);
  return <section className="card measured-section">
    <div className="card-h"><h2 className="section-title">{title}</h2><span className="small">สีจริงหลังปรับสี</span></div>
    <div className="card-b">
      {complete ? <>
        <div className="measured-list">{rows!.map((row, index) => <article className="measured-colour" key={`${row.hex}-${index}`}>
          <span className="measured-chip" style={{ backgroundColor: row.hex }} aria-label={`สี ${row.hex}`} />
          <div><b>{row.name}</b><div className="measured-values">RGB ({row.rgb.join(', ')}) · {row.hex} · {number(row.percent)}% · ΔE00 {number(row.de00)}</div><div className="small">{row.scale_match}</div></div>
        </article>)}</div>
        <details className="measured-table"><summary>ดูตารางสีทั้งหมด</summary><div className="tbl-wrap" role="region" aria-label="รายละเอียดกลุ่มสี" tabIndex={0}><table className="tbl">
          <thead><tr>{['ชื่อสีที่พบ', 'HEX', 'RGB ที่พบ', 'เปอร์เซ็นต์', 'ผลเทียบสเกล', 'ΔE00 ถึงสเกล'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows!.map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.hex}</td><td>{row.rgb.join(', ')}</td><td>{number(row.percent, 4)}%</td><td>{row.scale_match}</td><td>{number(row.de00, 4)}</td></tr>)}</tbody>
        </table></div></details>
        <p className="small measured-note">ΔE00 แสดงความใกล้เคียงกับช่องสีอ้างอิง ไม่ใช่ค่าความผิดพลาดของสีจริง</p>
      </> : <p className="small" role="status">{empty}</p>}
    </div>
  </section>;
}

function HistogramPlot({ data, channel, title, colour }: { data?: Histogram; channel: keyof Channels; title: string; colour: string }) {
  const before = data?.raw[channel] ?? [];
  const after = data?.cal[channel] ?? [];
  const bins = data?.bins ?? [];
  const available = before.length > 0 || after.length > 0;
  const peak = Math.max(1, ...before, ...after);
  const left = 57, top = 24, width = 277, height = 155;
  const x = (value: number) => left + value / 256 * width;
  const y = (value: number) => top + height - value / peak * height;
  // The API supplies bin left edges; keep raw outlines and corrected bars aligned.
  const step = before.map((count, i) => {
    const start = bins[i] ?? i * 256 / before.length;
    const end = bins[i + 1] ?? 256;
    return `${i === 0 ? 'M' : 'L'}${x(start)},${y(count)} L${x(end)},${y(count)}`;
  }).join(' ');
  return <figure className="histogram-plot"><figcaption>{title}</figcaption>
    <svg viewBox="0 0 360 224" role="img" aria-label={`${title}: ก่อนและหลังปรับสี`}>
      {[0, .5, 1].map(fraction => <g key={fraction}><line x1={left} x2={left + width} y1={y(peak * fraction)} y2={y(peak * fraction)} stroke="#e2e8f0" /><text x={left - 6} y={y(peak * fraction) + 4} textAnchor="end">{Math.round(peak * fraction).toLocaleString()}</text></g>)}
      {after.map((count, i) => {
        const start = bins[i] ?? i * 256 / after.length;
        const end = bins[i + 1] ?? 256;
        return <rect key={i} x={x(start)} y={y(count)} width={Math.max(0, x(end) - x(start))} height={top + height - y(count)} fill={colour} opacity="0.48" />;
      })}
      <path d={step} fill="none" stroke="#475569" strokeWidth="1.5" />
      <path d={`M${left},${top} V${top + height} H${left + width}`} fill="none" stroke="#64748b" />
      {[0, 64, 128, 192, 255].map(value => <text key={value} x={x(value)} y={top + height + 16} textAnchor="middle">{value}</text>)}
      <text x={left + width / 2} y="215" textAnchor="middle">ค่า RGB (0–255)</text>
      <text transform="translate(13 103) rotate(-90)" textAnchor="middle">จำนวนพิกเซล</text>
      {!available && <text x="195" y="105" textAnchor="middle">ไม่มีข้อมูลพิกเซล</text>}
    </svg>
  </figure>;
}

export default function AnalysisDetails({ result }: { result: DetailResult }) {
  const size = result.wound_size;
  return <div className="analysis-details">
    <Colours title="3. สีเนื้อที่ตรวจพบ" rows={result.measured_colours?.skin} empty="ไม่มีข้อมูลกลุ่มสีเนื้อ กรุณาวิเคราะห์ภาพใหม่เพื่อดูรายละเอียด" />
    <Colours title="4. สีแผลที่ตรวจพบ" rows={result.measured_colours?.wound} empty={result.has_wound ? 'ไม่มีข้อมูลกลุ่มสีแผล กรุณาวิเคราะห์ภาพใหม่เพื่อดูรายละเอียด' : 'ไม่พบรอยสีแผลที่เพียงพอสำหรับวิเคราะห์'} />
    <section className="card"><div className="card-h"><h2 className="section-title">5. ขนาดแผลโดยประมาณ</h2></div><div className="card-b">
      <div className="wound-dimensions">{[
        ['กว้าง', size?.width_cm, 'cm'], ['ยาว', size?.length_cm, 'cm'], ['พื้นที่รอยสี', size?.area_cm2, 'cm²'],
      ].map(([label, value, unit]) => <div className="metric" key={String(label)}><div className="label">{label}</div><div className="value">{number(value as number | null | undefined, 2)} <span>{unit}</span></div></div>)}</div>
      <p className="small measured-note">{size?.width_cm != null ? size.note || 'ค่าประมาณ: แผลและการ์ดต้องอยู่ระนาบใกล้กัน และต้องตรวจสอบ mask ด้วยสายตา' : size?.status || 'ยังไม่มีข้อมูลสำหรับวัดขนาดแผล'}</p>
    </div></section>
    <section className="card"><div className="card-h"><h2 className="section-title">6. Histogram</h2><span className="small">RGB ก่อน–หลังปรับสี · 32 bins</span></div><div className="card-b">
      <div className="histogram-legend"><span><i className="before-key" />ก่อนปรับสี</span><span><i className="after-key" />หลังปรับสี</span></div>
      <div className="histogram-grid">{(['skin', 'wound'] as const).flatMap(group => (['r', 'g', 'b'] as const).map((channel, i) => <HistogramPlot key={`${group}-${channel}`} data={result.histograms?.[group]} channel={channel} title={`${group === 'skin' ? 'สีเนื้อ' : 'สีแผล'} — ${channel.toUpperCase()}`} colour={['#e35d6a', '#42a99b', '#5099bd'][i]} />))}</div>
    </div></section>
  </div>;
}
