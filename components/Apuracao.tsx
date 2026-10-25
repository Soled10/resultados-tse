"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MAP from "@/lib/map.json";
import SNAPSHOT from "@/lib/snapshot.json";
import { REG, UFREG, UFS, getUF, share, type Snapshot, type UFData } from "@/lib/tse";

const fmt = (n: number) => n.toLocaleString("pt-BR");
const pctf = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
const INTERVAL_MS = 5_000;
const PER_TICK = 4;

type Mode = "load" | "live" | "snap" | "err";
type SortKey = "n" | "reg" | "pl" | "pf" | "m" | "pst";

const small: Record<string, [number, number]> = {
  df: [8, -10], se: [14, 4], al: [16, 0], pb: [24, 0], rn: [18, -6],
  es: [12, 0], rj: [8, 8],
};

function colorFor(d?: UFData) {
  if (!d || d.l + d.f === 0) return "var(--tie)";
  const [pl, pf] = share(d.l, d.f);
  const m = Math.abs(pl - pf);
  const k = Math.round(35 + (Math.min(m, 30) / 30) * 65);
  return `color-mix(in srgb, ${pl >= pf ? "var(--lula)" : "var(--flavio)"} ${k}%, var(--surface))`;
}

export default function Apuracao() {
  const [data, setData] = useState<Snapshot>(SNAPSHOT as Snapshot);
  const [mode, setMode] = useState<Mode>("load");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "m", dir: -1 });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const cursor = useRef(0);
  const lastLeader = useRef<"l" | "f" | null>(null);
  const [alerts, setAlerts] = useState<{ id: number; text: string; who: "l" | "f" }[]>([]);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const askPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try { setPerm(await Notification.requestPermission()); } catch { /* navegador bloqueou */ }
  }, []);

  // Pede permissão ao abrir a página; se o navegador exigir um gesto, pede no primeiro toque ou tecla.
  const autoAsked = useRef(false);
  useEffect(() => {
    if (perm !== "default") return;
    if (!autoAsked.current) { autoAsked.current = true; askPermission(); }
    const h = () => askPermission();
    window.addEventListener("pointerdown", h, { once: true });
    window.addEventListener("keydown", h, { once: true });
    return () => {
      window.removeEventListener("pointerdown", h);
      window.removeEventListener("keydown", h);
    };
  }, [perm, askPermission]);

  // Dispara o aviso quando muda quem está na frente no total nacional.
  const checkLead = useCallback((br: UFData) => {
    if (br.l + br.f === 0 || br.l === br.f) return;
    const leader: "l" | "f" = br.l > br.f ? "l" : "f";
    const prev = lastLeader.current;
    lastLeader.current = leader;
    if (!prev || prev === leader) return;
    const [pl, pf] = share(br.l, br.f);
    const margin = Math.abs(pl - pf).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const [win, lose] = leader === "l" ? ["Lula", "Flávio Bolsonaro"] : ["Flávio Bolsonaro", "Lula"];
    const text = `${win} acaba de passar ${lose} em ${margin}%`;
    setAlerts((a) => [{ id: Date.now(), text, who: leader }, ...a].slice(0, 4));
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Virada na apuração", { body: text, tag: "virada-" + Date.now() });
      }
    } catch { /* notificação indisponível neste aparelho */ }
  }, []);

  // A cada 5 s: placar nacional + um grupo de estados em rodízio (todos os 28 arquivos em ~35 s).
  // "full" busca tudo de uma vez (primeira carga e botão "Atualizar agora").
  const tick = useCallback(async (full = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (full) setBusy(true);
    try {
      const br = await getUF("br");
      setData((prev) => ({ at: new Date().toISOString(), uf: { ...prev.uf, br } }));
      setMode("live");
      checkLead(br);
      const all = [...UFS, "zz"];
      let batch: string[];
      if (full) batch = all;
      else {
        batch = Array.from({ length: PER_TICK }, (_, i) => all[(cursor.current + i) % all.length]);
        cursor.current = (cursor.current + PER_TICK) % all.length;
      }
      const uf: Record<string, UFData> = {};
      for (let i = 0; i < batch.length; i += 6) {
        const chunk = batch.slice(i, i + 6);
        const res = await Promise.allSettled(chunk.map((u) => getUF(u)));
        res.forEach((r, j) => { if (r.status === "fulfilled") uf[chunk[j]] = r.value; });
        if (i + 6 < batch.length) await new Promise((r) => setTimeout(r, 400));
      }
      setData((prev) => ({ at: new Date().toISOString(), uf: { ...prev.uf, ...uf } }));
    } catch {
      setMode((m) => (m === "live" ? "live" : "snap"));
    } finally {
      busyRef.current = false;
      if (full) setBusy(false);
    }
  }, [checkLead]);

  useEffect(() => {
    tick(true);
    const id = setInterval(() => {
      if (!document.hidden) tick(false);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const ufs = data.uf;
  const b = ufs.br;
  const shown = hover ?? selected ?? topUF(ufs) ?? "sp";

  const status = useMemo(() => {
    if (mode === "live") return { cls: "live", txt: "Ao vivo · TSE" };
    if (mode === "snap") return { cls: "snap", txt: "Atualização automática" };
    if (mode === "err") return { cls: "load", txt: "Sem conexão com o TSE" };
    return { cls: "load", txt: "Carregando" };
  }, [mode]);

  const nat = useMemo(() => {
    if (!b) return null;
    const [pl, pf] = share(b.l, b.f);
    const diff = Math.abs(b.l - b.f);
    return { pl, pf, diff };
  }, [b]);

  let nL = 0, nF = 0;
  for (const u of UFS) {
    const d = ufs[u];
    if (d && d.l + d.f) { if (d.l > d.f) nL++; else if (d.f > d.l) nF++; }
  }

  const regs = Object.entries(REG).map(([r, l]) => {
    let a = 0, f = 0, st = 0, ts = 0;
    for (const u of l) {
      const d = ufs[u];
      if (d) { a += d.l; f += d.f; st += d.st; ts += d.ts; }
    }
    return { r, a, f, pst: ts ? (st / ts) * 100 : 0, n: l.length };
  });
  if (ufs.zz) regs.push({ r: "Exterior", a: ufs.zz.l, f: ufs.zz.f, pst: ufs.zz.pst, n: 0 });

  const rows = UFS.map((u) => {
    const d = ufs[u] ?? { l: 0, f: 0, pst: 0 } as UFData;
    const [x, y] = share(d.l, d.f);
    return {
      u, n: (MAP.uf as any)[u]?.n ?? u, reg: UFREG[u], pl: x, pf: y, m: x - y,
      pst: d.pst, has: d.l + d.f > 0,
    };
  }).sort((a, c) => {
    if (a.has !== c.has) return a.has ? -1 : 1;
    const va = a[sort.k], vc = c[sort.k];
    return (typeof va === "string" ? va.localeCompare(String(vc), "pt-BR") : (va as number) - (vc as number)) * sort.dir;
  });

  const sortBy = (k: SortKey) =>
    setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : (k === "n" || k === "reg" ? 1 : -1) }));

  const ufd = ufs[shown];
  const [upl, upf] = share(ufd?.l ?? 0, ufd?.f ?? 0);
  const hasUF = !!ufd && ufd.l + ufd.f > 0;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="eyebrow">Eleições 2026 · 2º turno · 25 de outubro</div>
          <h1>Presidente da República</h1>
        </div>
        <div className="status">
          <span className={`pill ${status.cls}`}>
            <span className="dot" />
            <span>{status.txt}</span>
          </span>
          <small>
            {b ? `Totalização do TSE: ${b.dg} às ${b.hg} (Brasília)` : "—"}
          </small>
          {perm === "default" && (
            <button className="btn" type="button" onClick={askPermission}>Ativar avisos de virada</button>
          )}
          {perm === "unsupported" && (
            <small className="hint" style={{ maxWidth: 260, textAlign: "right" }}>
              Este navegador não aceita notificações. No iPhone, toque em Compartilhar → Adicionar à Tela de Início e abra pelo ícone. Os avisos também aparecem nesta página.
            </small>
          )}
          {perm === "granted" && <small>Avisos de virada ativados</small>}
          {perm === "denied" && <small>Avisos bloqueados no navegador</small>}
        </div>
      </header>

      {alerts.length > 0 && (
        <div className="alerts" role="status" aria-live="polite">
          {alerts.map((al) => (
            <div key={al.id} className={`alert ${al.who === "l" ? "al" : "af"}`}>
              <span><b>Virada:</b> {al.text}</span>
              <button className="btn" type="button" onClick={() => setAlerts((x) => x.filter((y) => y.id !== al.id))}>Fechar</button>
            </div>
          ))}
        </div>
      )}

      {mode === "snap" && (
        <div className="notice">
          <b>Não foi possível falar com o TSE agora.</b> Mostrando a última leitura salva. A página tenta de novo a cada 5 segundos.
        </div>
      )}

      <section className="board" aria-label="Resultado nacional">
        <div className="progress">
          <div className="row">
            <span><b className="num">{b ? pctf(b.pst) : "0%"}</b> das seções totalizadas</span>
            <span className="num">{b?.ts ? `${fmt(b.st)} de ${fmt(b.ts)} seções` : ""}</span>
          </div>
          <div className="track"><i style={{ width: `${b?.pst ?? 0}%` }} /></div>
        </div>
        <div className="cands">
          <div className="cand lula">
            <span className="party">13 · PT / PCdoB / PV</span>
            <span className="name">Lula</span>
            <span className="pct num">{nat && b && b.l + b.f ? pctf(nat.pl) : "–"}</span>
            <span className="votes num">{fmt(b?.l ?? 0)} votos</span>
            {b?.le ? <span className="badge">Eleito</span> : b && b.l > b.f ? <span className="badge">Na frente</span> : null}
          </div>
          <div className="vs">×</div>
          <div className="cand flavio right">
            <span className="party">22 · PL</span>
            <span className="name">Flávio Bolsonaro</span>
            <span className="pct num">{nat && b && b.l + b.f ? pctf(nat.pf) : "–"}</span>
            <span className="votes num">{fmt(b?.f ?? 0)} votos</span>
            {b?.fe ? <span className="badge">Eleito</span> : b && b.f > b.l ? <span className="badge">Na frente</span> : null}
          </div>
        </div>
        <div className="split" aria-hidden="true">
          <span className="l" style={{ width: `${nat?.pl ?? 0}%` }} />
          <span className="f" style={{ width: `${nat?.pf ?? 0}%` }} />
          <span className="mid" />
        </div>
        <div className="lead">
          {!b || b.l + b.f === 0
            ? "Apuração ainda não começou"
            : b.le || b.fe
              ? <><b>{b.le ? "Lula" : "Flávio Bolsonaro"} está eleito</b>, segundo o TSE</>
              : <><b>{b.l > b.f ? "Lula" : "Flávio Bolsonaro"}</b> lidera por <b>{fmt(nat!.diff)}</b> votos</>}
        </div>
        <div className="extra num">
          {b && [
            b.vb ? `Brancos: ${fmt(b.vb)}` : "",
            b.vn ? `Nulos: ${fmt(b.vn)}` : "",
            b.ab ? `Abstenção: ${fmt(b.ab)}` : "",
            b.el ? `Eleitorado: ${fmt(b.el)}` : "",
          ].filter(Boolean).map((s) => <span key={s}>{s}</span>)}
        </div>
      </section>

      <section className="mapsec" aria-label="Mapa por estado">
        <div className="mapbox">
          <div className="secHead">
            <h2>Quem lidera em cada estado</h2>
            <span className="eyebrow">Toque num estado</span>
          </div>
          <svg viewBox={`0 0 ${MAP.w} ${MAP.h}`} role="img" aria-label="Mapa do Brasil colorido pelo candidato que lidera em cada estado"
            onMouseLeave={() => setHover(null)}>
            {Object.entries(MAP.uf).map(([uf, g]) => (
              <path
                key={uf}
                d={g.d}
                className={`uf${selected === uf ? " sel" : ""}`}
                style={{ fill: colorFor(ufs[uf]) }}
                role="button"
                tabIndex={0}
                aria-label={g.n}
                onMouseEnter={() => setHover(uf)}
                onFocus={() => setHover(uf)}
                onClick={() => setSelected(uf)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(uf); } }}
              />
            ))}
            {Object.entries(MAP.uf).map(([uf, g]) => {
              const o = small[uf] ?? [0, 0];
              return (
                <text key={"t" + uf} x={g.c[0] + o[0]} y={g.c[1] + o[1]} className="uflabel">
                  {uf.toUpperCase()}
                </text>
              );
            })}
          </svg>
          <div className="legend">
            <span className="ramp">Lula <span style={{ background: "var(--lula)" }} /><span style={{ background: "color-mix(in srgb, var(--lula) 45%, var(--surface))" }} /></span>
            <span className="ramp"><span style={{ background: "color-mix(in srgb, var(--flavio) 45%, var(--surface))" }} /><span style={{ background: "var(--flavio)" }} /> Flávio</span>
            <span>Cor mais forte = vantagem maior</span>
          </div>
        </div>
        <div className="side">
          <div className="panel">
            <span className="eyebrow">{shown ? `${UFREG[shown] ?? ""} · ${shown.toUpperCase()}` : "Estado"}</span>
            <h3>{(MAP.uf as any)[shown]?.n ?? "Selecione um estado"}</h3>
            <div className="duo">
              <div className="lu"><span className="k">Lula</span><span className="p num">{hasUF ? pctf(upl) : "–"}</span><span className="k num">{fmt(ufd?.l ?? 0)} votos</span></div>
              <div className="fl"><span className="k">Flávio</span><span className="p num">{hasUF ? pctf(upf) : "–"}</span><span className="k num">{fmt(ufd?.f ?? 0)} votos</span></div>
            </div>
            <div className="split" style={{ height: 12 }}>
              <span className="l" style={{ width: `${upl}%` }} />
              <span className="f" style={{ width: `${upf}%` }} />
              <span className="mid" />
            </div>
            <span className="hint num">
              {ufd ? `${pctf(ufd.pst)} das seções totalizadas${hasUF ? ` · vantagem de ${fmt(Math.abs(ufd.l - ufd.f))} votos` : ""}` : "Sem dados ainda."}
            </span>
          </div>
          <div className="panel">
            <span className="eyebrow">Estados vencidos até agora</span>
            <div className="tally">
              <div className="lu"><b className="num">{nL}</b><span>com Lula na frente</span></div>
              <div className="fl"><b className="num">{nF}</b><span>com Flávio na frente</span></div>
            </div>
            <span className="hint">27 unidades da federação (26 estados + DF).</span>
          </div>
        </div>
      </section>

      <section aria-label="Resultado por região">
        <div className="secHead"><h2>Por região</h2><span className="eyebrow">Soma dos votos dos estados</span></div>
        <div className="regions">
          {regs.map((g) => {
            const [x, y] = share(g.a, g.f);
            const has = g.a + g.f > 0;
            const cls = !has ? "" : g.a > g.f ? "lw" : "fw";
            const who = !has ? "Sem votos apurados" : g.a > g.f ? "Lula na frente" : "Flávio na frente";
            return (
              <div key={g.r} className={`reg ${cls}`}>
                <div className="hd"><b>{g.r}</b><span className="who">{who}</span></div>
                <div className="split"><span className="l" style={{ width: `${x}%` }} /><span className="f" style={{ width: `${y}%` }} /><span className="mid" /></div>
                <div className="nums num"><span className="a">{has ? pctf(x) : "–"}</span><span className="b">{has ? pctf(y) : "–"}</span></div>
                <div className="nums num sub"><span>{fmt(g.a)} votos</span><span>{fmt(g.f)} votos</span></div>
                <span className="sub num">{pctf(g.pst)} apurado{g.n ? ` · ${g.n} UFs` : " · votos no exterior"}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Tabela por estado">
        <div className="secHead"><h2>Todos os estados</h2><span className="eyebrow">Clique no título para ordenar</span></div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th onClick={() => sortBy("n")} tabIndex={0}>Estado</th>
                <th onClick={() => sortBy("reg")} tabIndex={0}>Região</th>
                <th className="r" onClick={() => sortBy("pl")} tabIndex={0}>Lula</th>
                <th className="r" onClick={() => sortBy("pf")} tabIndex={0}>Flávio</th>
                <th onClick={() => sortBy("m")} tabIndex={0}>Vantagem</th>
                <th className="r" onClick={() => sortBy("pst")} tabIndex={0}>Apurado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.u} onClick={() => { setSelected(r.u); document.querySelector(".mapsec")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                  <td><b>{r.n}</b></td>
                  <td>{r.reg}</td>
                  <td className="r num">{r.has ? pctf(r.pl) : "–"}</td>
                  <td className="r num">{r.has ? pctf(r.pf) : "–"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div className="mini"><span className="l" style={{ width: `${r.pl}%` }} /><span className="f" style={{ width: `${r.pf}%` }} /></div>
                      {r.has && (
                        <span className={`chip ${r.m > 0 ? "l" : r.m < 0 ? "f" : "t"}`}>
                          {r.m > 0 ? "Lula" : r.m < 0 ? "Flávio" : "Empate"} +{Math.abs(r.m).toFixed(1).replace(".", ",")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="r num">{pctf(r.pst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        <span>Fonte: <a href="https://resultados.tse.jus.br/oficial/app/index.html" target="_blank" rel="noopener">Tribunal Superior Eleitoral (TSE)</a>, divulgação oficial de resultados. Percentuais sobre votos válidos.</span>
        <span>Página independente, sem vínculo com o TSE ou com as campanhas. O resultado oficial é o divulgado pelo TSE.</span>
        <span>
          <button className="btn" type="button" onClick={() => tick(true)} disabled={busy}>
            {busy ? "Atualizando…" : "Atualizar agora"}
          </button>
        </span>
      </footer>
    </div>
  );
}

function topUF(ufs: Record<string, UFData>): string | null {
  let best: string | null = null, bestN = -1;
  for (const u of UFS) {
    const d = ufs[u];
    if (d && d.l + d.f > bestN) { bestN = d.l + d.f; best = u; }
  }
  return bestN > 0 ? best : null;
}
