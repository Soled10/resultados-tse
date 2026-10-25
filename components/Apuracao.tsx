"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MAP from "@/lib/map.json";
import SNAPSHOT from "@/lib/snapshot.json";
import { REG, UFREG, UFS, getUF, share, type Snapshot, type UFData } from "@/lib/tse";

const fmt = (n: number) => n.toLocaleString("pt-BR");
const pctf = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
const INTERVAL_MS = 60_000;

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

  const cycle = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const br = await getUF("br");
      const uf: Record<string, UFData> = { br };
      setData((prev) => ({ at: new Date().toISOString(), uf: { ...prev.uf, br } }));
      setMode("live");
      for (const u of [...UFS, "zz"]) {
        try {
          uf[u] = await getUF(u);
        } catch {
          /* estado sem arquivo ainda: mantém o último valor */
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      setData((prev) => ({ at: new Date().toISOString(), uf: { ...prev.uf, ...uf } }));
    } catch {
      setMode((m) => (m === "live" ? "live" : "snap"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    cycle();
    const id = setInterval(() => {
      if (!document.hidden) cycle();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [cycle]);

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
        </div>
      </header>

      {mode === "snap" && (
        <div className="notice">
          <b>Não foi possível falar com o TSE agora.</b> Mostrando a última leitura salva. A página tenta de novo a cada minuto.
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
          <button className="btn" type="button" onClick={cycle} disabled={busy}>
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
