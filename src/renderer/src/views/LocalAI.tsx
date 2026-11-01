import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelFit, ModelOption, ModelReport, OllamaStatus, PullProgress } from '@shared/types';
import type { Actions } from '../App';
import { AiOutput } from '../components/AiOutput';
import { useAi } from '../useAi';

const FIT_LABEL: Record<ModelFit, string> = { gpu: 'Fast · GPU', cpu: 'OK · CPU', partial: 'Slow', no: "Won't fit" };
const FIT_TONE: Record<ModelFit, string> = { gpu: 'ok', cpu: 'info', partial: 'warn', no: '' };

export function LocalAI({ actions }: { actions: Actions }) {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [report, setReport] = useState<ModelReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({});
  const [prompt, setPrompt] = useState('');
  const ai = useAi();

  const [installing, setInstalling] = useState(false);
  const startedRef = useRef(false);
  const refreshStatus = useCallback(() => window.cockpit.ollamaStatus().then(setStatus), []);

  // While an install runs in the terminal, watch for Ollama to appear, then start it once.
  useEffect(() => {
    if (!installing) return;
    const deadline = Date.now() + 15 * 60 * 1000;
    const timer = setInterval(async () => {
      const s = await window.cockpit.ollamaStatus();
      setStatus(s);
      if (s.installed && !s.running && !startedRef.current) {
        startedRef.current = true;
        await window.cockpit.startOllama();
      }
      if (s.running || Date.now() > deadline) {
        setInstalling(false);
        if (s.running && !report) scan();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [installing]);

  const install = () => {
    startedRef.current = false;
    setInstalling(true);
    actions.installOllama();
  };
  const start = async () => {
    await window.cockpit.startOllama();
    setTimeout(refreshStatus, 2500);
  };

  useEffect(() => {
    refreshStatus();
    window.cockpit.getSettings().then((s) => setDefaultModel(s.localModel));
    return window.cockpit.onPullProgress((p) => {
      setPulls((all) => ({ ...all, [p.tag]: p }));
      if (p.done) {
        refreshStatus();
        if (!p.error) setTimeout(() => setPulls(({ [p.tag]: _, ...rest }) => rest), 1500);
      }
    });
  }, [refreshStatus]);

  const scan = async () => {
    setScanning(true);
    try {
      setReport(await window.cockpit.scanModels());
    } finally {
      setScanning(false);
    }
  };

  const installed = new Set(status?.models.map((m) => m.name) ?? []);
  const isInstalled = (tag: string) => installed.has(tag) || installed.has(`${tag}:latest`);
  const activeModel = defaultModel ?? status?.models[0]?.name ?? null;

  const setDefault = async (tag: string) => setDefaultModel((await window.cockpit.setLocalModel(tag)).localModel);
  const remove = async (tag: string) => {
    await window.cockpit.removeModel(tag);
    if (defaultModel === tag) setDefaultModel((await window.cockpit.setLocalModel(null)).localModel);
    refreshStatus();
  };

  const rec = report?.options.find((o) => o.tag === report.recommended);
  const fast = report?.options.find((o) => o.tag === report.fastPick);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Local AI</h1>
          <p className="muted">A free model on your own machine for summaries, briefs and quick questions. No Claude tokens, and nothing leaves your computer.</p>
        </div>
      </header>

      <div className="grid2">
        <section className="card">
          <h3>Ollama</h3>
          {status === null && <p className="muted">Checking…</p>}
          {status && !status.installed && (
            <>
              <p>Ollama runs local models. It isn't installed yet.</p>
              <div className="row">
                <button className="btn primary" onClick={install} disabled={installing}>
                  {installing ? 'Installing… (see terminal)' : 'Install Ollama'}
                </button>
                <button className="btn" onClick={() => actions.openExternal('https://ollama.com/download')}>
                  Manual download
                </button>
              </div>
              <p className="muted small">
                Runs the official installer in a terminal below so you can see every step. On Windows that's winget, which checks the installer's
                SHA-256. Nothing is installed until you click.
              </p>
            </>
          )}
          {status?.installed && !status.running && (
            <>
              <p>Ollama is installed but not running.</p>
              <div className="row">
                <button className="btn primary" onClick={start}>
                  Start Ollama
                </button>
                <button className="btn" onClick={refreshStatus}>
                  Check again
                </button>
              </div>
            </>
          )}
          {status?.running && (
            <>
              <p>
                <span className="chip ok">running</span> <span className="muted small">v{status.version}</span>
              </p>
              {status.models.length === 0 && <p className="muted">No models downloaded yet. Run the check to pick one.</p>}
              <ul className="list">
                {status.models.map((m) => (
                  <li key={m.name} className="list-row static">
                    <span className="grow mono">{m.name}</span>
                    <span className="muted small">{m.sizeGB} GB</span>
                    {activeModel === m.name ? (
                      <span className="chip ok">default</span>
                    ) : (
                      <button className="btn small" onClick={() => setDefault(m.name)}>
                        Use
                      </button>
                    )}
                    <button className="btn small" onClick={() => remove(m.name)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h3>What can my machine run?</h3>
          {!report && <p className="muted">Checks your CPU, memory and GPU, then recommends the best model that will run well.</p>}
          {report && (
            <div className="specs">
              <Spec label="CPU" value={`${report.system.cpu} · ${report.system.cores} threads`} />
              <Spec label="Memory" value={`${report.system.ramGB} GB`} />
              <Spec label="GPU" value={report.system.bestGpu ? `${report.system.bestGpu.name} · ${report.system.bestGpu.vramGB} GB` : 'No dedicated GPU found'} />
              <Spec label="Free disk" value={report.system.freeDiskGB != null ? `${report.system.freeDiskGB} GB` : 'unknown'} />
            </div>
          )}
          <button className="btn primary" onClick={scan} disabled={scanning}>
            {scanning ? 'Checking…' : report ? 'Check again' : 'Check my machine'}
          </button>
        </section>
      </div>

      {rec && (
        <section className="card hero">
          <div className="eyebrow">Best for this machine</div>
          <ModelLine m={rec} installed={isInstalled(rec.tag)} pull={pulls[rec.tag]} canPull={!!status?.running} isDefault={activeModel === rec.tag} onDefault={setDefault} big />
          {fast && (
            <>
              <div className="eyebrow">Faster, lighter option</div>
              <ModelLine m={fast} installed={isInstalled(fast.tag)} pull={pulls[fast.tag]} canPull={!!status?.running} isDefault={activeModel === fast.tag} onDefault={setDefault} />
            </>
          )}
        </section>
      )}

      {report && (
        <section className="card">
          <h3>All models</h3>
          <ul className="list">
            {report.options.map((m) => (
              <li key={m.tag} className="list-row static">
                <ModelLine m={m} installed={isInstalled(m.tag)} pull={pulls[m.tag]} canPull={!!status?.running} isDefault={activeModel === m.tag} onDefault={setDefault} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3>Ask about your work {activeModel && <span className="muted mono">· {activeModel}</span>}</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) ai.start({ kind: 'ask', prompt });
          }}
        >
          <input className="input grow" placeholder="e.g. What's pending on tatvafit? · What did I do yesterday? · Explain git rebase --onto" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          {ai.running ? (
            <button type="button" className="btn" onClick={ai.stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" disabled={!prompt.trim()}>
              Ask
            </button>
          )}
        </form>
        <AiOutput {...ai} />
      </section>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="spec">
      <span className="muted small">{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface LineProps {
  m: ModelOption;
  installed: boolean;
  pull?: PullProgress;
  canPull: boolean;
  isDefault: boolean;
  onDefault: (tag: string) => void;
  big?: boolean;
}

function ModelLine({ m, installed, pull, canPull, isDefault, onDefault, big }: LineProps) {
  const pct = pull?.total ? Math.round(((pull.completed ?? 0) / pull.total) * 100) : null;
  const pulling = pull && !pull.done;
  return (
    <div className="model-line">
      <div className="grow">
        <div className={big ? 'model-name big' : 'model-name'}>
          <span className="mono">{m.tag}</span>
          <span className={`chip ${FIT_TONE[m.fit]}`}>{FIT_LABEL[m.fit]}</span>
          {m.use !== 'general' && <span className="chip">{m.use}</span>}
        </div>
        <div className="muted small">
          {m.blurb} {m.sizeExact ? '' : '~'}
          {m.sizeGB} GB download. {m.reason}
        </div>
        {pulling && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${pct ?? 0}%` }} />
            <span className="small muted">
              {pull.status}
              {pct != null && ` · ${pct}%`}
            </span>
          </div>
        )}
        {pull?.error && <div className="small warn-text">{pull.error}</div>}
      </div>
      {installed ? (
        isDefault ? (
          <span className="chip ok">default</span>
        ) : (
          <button className="btn small" onClick={() => onDefault(m.tag)}>
            Use
          </button>
        )
      ) : pulling ? (
        <button className="btn small" onClick={() => window.cockpit.cancelPull(m.tag)}>
          Cancel
        </button>
      ) : (
        <button
          className={`btn ${big ? 'primary' : 'small'}`}
          disabled={!canPull || m.fit === 'no'}
          title={canPull ? '' : 'Start Ollama first'}
          onClick={() => window.cockpit.pullModel(m.tag)}
        >
          Download
        </button>
      )}
    </div>
  );
}
