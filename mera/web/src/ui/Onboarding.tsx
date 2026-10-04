import { useEffect, useRef, useState } from 'react';
import { api, type JobState, type ProjectInfo } from '../api';

const STAGES: [string, string][] = [
  ['ingest', 'Pick sharp keyframes with good coverage'],
  ['transcribe', 'Transcribe your description'],
  ['facts', 'Pull out what you said about the land'],
  ['reconstruct', 'Reconstruct the plot in 3D (slowest step)'],
  ['site', 'Calibrate to your plot size and build the model'],
];

/** New survey: drop the video(s) and an optional voice recording, then watch the pipeline run. */
export function NewSurvey({ onOpen, existing }: { onOpen: (pid: string) => void; existing: ProjectInfo[] }) {
  const [name, setName] = useState('My plot');
  const [dims, setDims] = useState({ w0: '', w1: '', d0: '', d1: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [pid, setPid] = useState<string | null>(null);
  const [upload, setUpload] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const start = async () => {
    setErr(null);
    try {
      const n = (x: string) => Number(x.replace(',', '.'));
      const w = [n(dims.w0), n(dims.w1 || dims.w0)], d = [n(dims.d0), n(dims.d1 || dims.d0)];
      const { id } = await api.create(name, w.every((x) => x > 0) && d.every((x) => x > 0) ? { width: w, depth: d } : undefined);
      await api.upload(id, files, setUpload);
      await api.run(id);
      setPid(id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (pid) return <Progress pid={pid} onOpen={onOpen} />;
  const videos = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|mkv|webm)$/i.test(f.name));
  return (
    <div className="center">
      <div className="card">
        <h2>Survey a plot</h2>
        <p className="muted" style={{ marginTop: 0 }}>Walk the plot filming slowly, ideally around the whole boundary, and describe it out loud. Add a separate voice note if you have one. Everything runs on this machine.</p>
        <label className="small">Name <input value={name} onChange={(e) => setName(e.target.value)} style={{ marginLeft: 8, padding: 4, borderRadius: 6, border: '1px solid var(--line-2)' }} /></label>
        <div className="small" style={{ marginTop: 10 }}>
          Plot size from your documents (sets the true scale):
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            along the road <input className="num" style={{ width: 52 }} placeholder="48" value={dims.w0} onChange={(e) => setDims({ ...dims, w0: e.target.value })} />–
            <input className="num" style={{ width: 52 }} placeholder="49" value={dims.w1} onChange={(e) => setDims({ ...dims, w1: e.target.value })} /> m,
            road to back <input className="num" style={{ width: 52 }} placeholder="50" value={dims.d0} onChange={(e) => setDims({ ...dims, d0: e.target.value })} />–
            <input className="num" style={{ width: 52 }} placeholder="" value={dims.d1} onChange={(e) => setDims({ ...dims, d1: e.target.value })} /> m
          </div>
        </div>
        <div className={`drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); setFiles([...files, ...Array.from(e.dataTransfer.files)]); }}>
          {files.length ? files.map((f) => <div key={f.name} className="small">{f.name} · {(f.size / 1e6).toFixed(1)} MB</div>) : 'Drop videos and voice recordings here, or click to choose'}
          <input ref={input} type="file" multiple accept="video/*,audio/*" hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
        </div>
        {upload > 0 && upload < 1 && <div className="progress" style={{ marginBottom: 10 }}><div style={{ width: `${upload * 100}%` }} /></div>}
        {err && <div className="note warn">{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" disabled={!videos.length} onClick={start}>Upload and reconstruct</button>
          {existing.filter((p) => p.hasSite).map((p) => <button key={p.id} className="btn" onClick={() => onOpen(p.id)}>Open “{p.name}”</button>)}
        </div>
      </div>
    </div>
  );
}

export function Progress({ pid, onOpen }: { pid: string; onOpen: (pid: string) => void }) {
  const [job, setJob] = useState<JobState | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const j = await api.job(pid);
        if (!alive) return;
        setJob(j);
        if (j.stages.site?.status === 'done' && !j.running) { onOpen(pid); return; }
      } catch { /* server restarting */ }
      if (alive) setTimeout(tick, 1500);
    };
    tick();
    return () => { alive = false; };
  }, [pid, onOpen]);
  return (
    <div className="center">
      <div className="card">
        <h2>Reconstructing “{pid}”</h2>
        <p className="muted" style={{ marginTop: 0 }}>On a laptop CPU this takes roughly 3–5 minutes per minute of video. You can leave this page open.</p>
        {STAGES.map(([id, label]) => {
          const s = job?.stages[id];
          return (
            <div key={id} className={`stage ${s?.status ?? ''}`}>
              <span className="st" />
              <div><div>{label}</div><div className="small muted">{s?.message ?? 'waiting'}</div></div>
              <span className="small num muted">{s?.fraction !== undefined ? Math.round(s.fraction * 100) + '%' : ''}</span>
              {s?.status === 'running' && <div className="progress"><div style={{ width: `${(s.fraction ?? 0) * 100}%` }} /></div>}
            </div>
          );
        })}
        {job?.error && <pre className="note warn" style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{job.error}</pre>}
      </div>
    </div>
  );
}
