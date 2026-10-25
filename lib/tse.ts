// Leitura dos arquivos oficiais de totalização do TSE (eleição presidencial 2º turno 2026).
export const TSE_BASE = "https://resultados.tse.jus.br/oficial/ele2026/6258/dados/";

export const REG: Record<string, string[]> = {
  Norte: ["ac", "ap", "am", "pa", "ro", "rr", "to"],
  Nordeste: ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"],
  "Centro-Oeste": ["df", "go", "mt", "ms"],
  Sudeste: ["es", "mg", "rj", "sp"],
  Sul: ["pr", "rs", "sc"],
};
export const UFREG: Record<string, string> = {};
for (const [r, l] of Object.entries(REG)) for (const u of l) UFREG[u] = r;
export const UFS = Object.keys(UFREG);

export type UFData = {
  l: number; f: number; le: boolean; fe: boolean;
  pst: number; st: number; ts: number;
  vb: number; vn: number; tv: number; el: number; ab: number;
  dg: string; hg: string;
};
export type Snapshot = { at: string | null; uf: Record<string, UFData> };

const num = (s: unknown): number => {
  if (s == null || s === "") return 0;
  return Number(String(s).replace(/\./g, "").replace(",", "."));
};

// Extrai o essencial de um arquivo "-u.json" do TSE.
export function parse(j: any): UFData {
  const out: UFData = {
    l: 0, f: 0, le: false, fe: false,
    pst: num(j.s?.pst), st: num(j.s?.st), ts: num(j.s?.ts),
    vb: num(j.v?.vb), vn: num(j.v?.tvn), tv: num(j.v?.tv), el: num(j.e?.te), ab: num(j.e?.a),
    dg: j.dg, hg: j.hg,
  };
  const walk = (x: any) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") {
      if (Array.isArray(x.cand)) for (const c of x.cand) {
        if (String(c.n) === "13") { out.l = num(c.vap); out.le = c.e === "s"; }
        if (String(c.n) === "22") { out.f = num(c.vap); out.fe = c.e === "s"; }
      }
      Object.values(x).forEach(walk);
    }
  };
  walk(j.carg ?? []);
  return out;
}

export async function getUF(uf: string): Promise<UFData> {
  const r = await fetch(`${TSE_BASE}${uf}/${uf}-c0001-e006258-u.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return parse(await r.json());
}

export const share = (a: number, b: number): [number, number] => {
  const t = a + b;
  return t ? [(a / t) * 100, (b / t) * 100] : [0, 0];
};
