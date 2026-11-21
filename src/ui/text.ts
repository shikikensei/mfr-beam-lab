// Every sentence the step-by-step views generate. Kept apart from the drawing code so the
// wording (and a later translation) can change without touching it.
import type { BoxRecord, PlanStep, RequestRecord, SimConfig, SimResult, Us } from '../engine/types.ts';

export const sec = (t: Us): string => (t / 1e6).toFixed(3) + ' s';
export const msTxt = (t: Us): string => (t / 1000).toFixed(0) + ' ms';

// "plus" is this tool's extension. It must never be labelled as the paper's method.
export const METHODS = {
  plus: { label: '動的RSI＋先読み', note: '本ツールの拡張', scheduler: 'drsi', protect: 'followers' },
  paper: { label: '動的RSI', note: '論文の記述どおり', scheduler: 'drsi', protect: 'paper' },
  legacy: { label: '従来型', note: '固定長の箱', scheduler: 'legacy', protect: 'paper' },
} as const;
export type MethodId = keyof typeof METHODS;

/** Every scheduler of chapters 2 and 3, in the order they are listed. `how` is the rule in one breath. */
export const LAB = [
  { id: 'fifo', label: '到着順', cfg: { scheduler: 'fifo' }, how: '用意ができた順に実行します。優先度も期限も見ません。捜索と固定タスクを同じ列に並べます。' },
  { id: 'template', label: '固定テンプレート', cfg: { scheduler: 'template' }, how: '100 ms の周期を、固定タスク用 40 % と捜索用 60 % にあらかじめ割ります。自分の枠が余っても、相手には貸しません。' },
  { id: 'priority', label: '固定優先度', cfg: { scheduler: 'priority' }, how: '優先度の高いものから実行します。固定タスクが常に先で、捜索は残った時間に入ります。捜索の中では水平線が先です。' },
  { id: 'edf', label: '最早期限優先', cfg: { scheduler: 'edf' }, how: '終わらせるべき時刻がいちばん近いものから実行します。優先度は見ません。捜索ビームの期限をどう置くかで結果が変わります。' },
  { id: 'balance', label: 'タイムバランス', cfg: { scheduler: 'balance' }, how: '「遅れ ÷ 周期」がいちばん大きいものから実行します。遅れを全員で分け合う考え方です。' },
  { id: 'tsbf', label: '2勾配ベネフィット（原文未確認の要約に基づく実装）', cfg: { scheduler: 'tsbf' }, how: '決まった長さの窓ごとに、まず追尾を並べます。希望時刻で最大、前後にずれるほど下がる山形の「ベネフィット」の合計が最大になるように開始時刻を決め、入りきらなければピークの低いものから落とします。次に、残った空きを捜索で埋めます。捜索は、前回からの経過時間が長い領域から選びます。所望のペースより遅れても、あとで取り戻すことはしません。Moo (2010) の報告書の二次要約から実装したもので、原文は未確認です。' },
  { id: 'legacy', label: '従来型（固定長の箱）', cfg: { scheduler: 'legacy' }, how: '100 ms の箱に、固定タスクを要求時刻で置いてから、残りを捜索で埋めます。' },
  { id: 'paper', label: '動的RSI（論文の記述どおり）', cfg: { scheduler: 'drsi', protect: 'paper' }, how: '次の固定タスクまでを箱にし、後ろ寄せにしてから捜索を詰め、寄せて閉じます（1章）。' },
  { id: 'plus', label: '動的RSI＋先読み（本ツールの拡張）', cfg: { scheduler: 'drsi', protect: 'followers' }, how: '上に加えて、待っている固定タスクの場所を先に確保します。論文にはない処理です。' },
] as const satisfies readonly { id: string; label: string; cfg: Partial<SimConfig>; how: string }[];
export type LabId = (typeof LAB)[number]['id'];
export const labOf = (id: string) => LAB.find((m) => m.id === id) ?? LAB[LAB.length - 1];

export const PHASES = {
  drsi: ['次の固定タスクを選ぶ', '捜索の不足量を計算', '箱を捜索で詰める', '固定タスクを寄せて実行'],
  legacy: ['固定長の箱を用意', '固定タスクを優先度順に置く', '残りを捜索で埋める'],
};
/** Which phase chip a step lights up (-1: none). */
export function phaseOf(step: PlanStep): number {
  switch (step.kind) {
    case 'select': case 'legacyBox': return 0;
    case 'deficit': case 'legacyFixed': return 1;
    case 'fill': case 'legacyFill': return 2;
    case 'close': case 'chain': return 3;
    default: return -1;
  }
}

const KIND = { critical: '緊急タスク', confirm: '確認照射', retry: '再照射', trackHigh: '追尾更新', track: '追尾更新' } as const;
/** Hand-built scenes name their two tasks; everything else is "target n's update". */
export const reqName = (sim: SimResult, q: RequestRecord): string => {
  if (q.kind === 'critical') return KIND.critical;
  const name = sim.scenario.targets[q.target].name;
  return name ?? `目標${q.target + 1}の${KIND[q.kind]}`;
};
const outcome = (q: RequestRecord): string => (q.kind === 'critical' || q.scripted ? '実行した' : q.hit ? '命中' : '外れ');
const DROP = { timeout: '許容範囲を過ぎた', conflict: '優先度の高い固定タスクと重なった', boundary: '箱の境界をまたげなかった' } as const;

export interface Caption { did: string[]; why: string[]; result: string[] }

export function describe(sim: SimResult, step: PlanStep, box: BoxRecord): Caption {
  const R = sim.requests, names = sim.scenario.regions.map((r) => r.name);
  const did: string[] = [], why: string[] = [], result: string[] = [];
  switch (step.kind) {
    case 'select': {
      if (step.nft === null) {
        did.push('固定タスクを選ばず、捜索だけの箱にした。');
        why.push(step.why === 'none' ? '待っている固定タスクがない。' : `いちばん近い固定タスクでも、最遅位置に置くと箱が最大長（${msTxt(sim.config.maxDrsi)}）を超える。`);
        result.push(`箱は ${sec(step.limit)} まで。`);
      } else {
        const q = R[step.nft];
        did.push(`${reqName(sim, q)}を、次の固定タスクに選んだ。`);
        why.push(step.caseNo === 2 ? '優先度は低いが、期限が先に来る。上位の固定タスクが始まる前に終われるので、先に置ける（ケース2）。'
          : step.returned.length ? '下位のタスクとぶつかっていて、そのタスクはこのタスクの前にも後ろにも入らない。ぶつかったときは上位を選ぶ（ケース3）。'
          : '待っている固定タスクの中で、期限（最遅開始）がいちばん早い（ケース1）。');
        why.push(`要求時刻 ${sec(q.req)}、許容範囲 ${sec(q.earliest)}〜${sec(q.latest)}。`);
        if (step.tentative! >= q.latest) result.push(`いちばん遅い ${sec(step.tentative!)} に仮置きした。ここまでが今回の箱。`);
        else if (step.caseNo === 2) result.push(`上位の固定タスクが後ろに続けられるよう、${sec(step.tentative!)} に仮置きした。`);
        else result.push(`後ろで待つ固定タスクが入れるよう、最遅より手前の ${sec(step.tentative!)} に仮置きした（本ツールの拡張）。`);
      }
      for (const x of step.returned) result.push(`${reqName(sim, R[x.id])}は、${reqName(sim, R[x.blocker])}の前にも後ろにも入らない。タスク管理へ返した（ケース3）。`);
      break;
    }
    case 'deficit':
      did.push('捜索領域ごとの不足量を計算した。');
      why.push('不足量 ＝ 所望のペースなら今までに済んでいるはずの量 − 実際に済んだ量。');
      result.push(step.ftd.map((f, i) => `${names[i]} ${f >= 0 ? '+' : '−'}${msTxt(Math.abs(f))}`).join('、') + '。');
      result.push(step.ftd.some((f) => f > 0) ? `不足の大きい${names[step.order[0]]}から詰める。` : 'どの領域も所望のペースに追いついている。');
      break;
    case 'fill':
      if (step.placed.some((n) => n > 0)) {
        did.push('箱を捜索で前から詰めた：' + step.placed.map((n, i) => `${names[i]} ${n}本`).filter((_, i) => step.placed[i] > 0).join('、') + '。');
        why.push(sim.config.fill === 'full' ? '入るだけ詰める設定。' : '不足が解消する本数まで。入らない分は次の箱へ回る。');
        result.push(`${sec(step.flexEnd)} まで埋まった。`);
      } else {
        did.push('捜索は詰めなかった。');
        why.push('不足している領域がないか、1本も入らない。');
      }
      break;
    case 'close': {
      if (step.nft === null) {
        did.push('固定タスクなしで箱を閉じた。');
        if (step.spare) result.push(`頼むものがなく、${msTxt(step.spare)} は余裕として空いた。`);
        if (step.gap) result.push(`${msTxt(step.gap)} は捜索が入らず、隙間になった。`);
        if (!step.gap && !step.spare) result.push('箱は捜索で埋まり、隙間は残らなかった。');
        break;
      }
      const q = R[step.nft];
      if (step.to! < step.from!) {
        did.push(`${reqName(sim, q)}を、仮置きの ${sec(step.from!)} から ${sec(step.to!)} へ前に寄せて実行した。`);
        why.push(step.spare ? '捜索は足りているので、詰めずに要求時刻で実行する。' : '捜索の後ろに空きを残さないため。動かせるのは許容範囲の内側だけ。');
      } else {
        did.push(`${reqName(sim, q)}を、仮置きの位置のまま実行した。`);
        why.push('捜索が仮置きの位置まで詰まっている。');
      }
      result.push(outcome(q) + '。' + (step.gap ? `許容範囲より前には動かせず、${msTxt(step.gap)} の隙間が残った。` : step.spare ? `${msTxt(step.spare)} は余裕として空いた。` : '隙間なし。'));
      break;
    }
    case 'chain': {
      const q = R[step.id];
      did.push(`続けて、${reqName(sim, q)}を実行した。`);
      why.push('許容範囲がいまの時刻を含んでいるので、隙間なしで続けられる。');
      result.push(outcome(q) + '。箱がその分だけ延びた。');
      break;
    }
    case 'legacyBox':
      did.push(`長さ ${msTxt(box.end - box.start)} の箱を用意した。`);
      why.push('従来型は、決まった長さの箱を順に埋めていく。');
      result.push(`この箱で扱う固定タスクは ${step.candidates.length} 件。`);
      break;
    case 'legacyFixed':
      did.push(step.placed.length ? '固定タスクを優先度の高い順に置いた。' : '置く固定タスクはなかった。');
      if (step.placed.length) why.push('要求時刻に置く。ふさがっていれば、許容範囲の中でいちばん近い空きに置く。');
      for (const id of step.placed) result.push(`${reqName(sim, R[id])}：${sec(R[id].start!)}、${outcome(R[id])}。`);
      for (const id of step.carried) result.push(`${reqName(sim, R[id])}：この箱に入らず、次の箱へ持ち越し。`);
      for (const d of step.dropped) result.push(`${reqName(sim, R[d.id])}：取りこぼし（${DROP[d.reason]}）。`);
      break;
    case 'legacyFill':
      did.push('残りを捜索で埋めた：' + step.placed.map((n, i) => `${names[i]} ${n}本`).join('、') + '。');
      why.push('優先度の高い領域から順に。固定タスクは動かさない。');
      if (step.gap) result.push(`${msTxt(step.gap)} は捜索が入らず、隙間になった。`);
      if (step.spare) result.push(`${msTxt(step.spare)} は頼むものがなく、余裕として空いた。`);
      if (!step.gap && !step.spare) result.push('空きは残らなかった。');
      break;
    case 'pick':
      break;
    case 'interrupt':
      did.push(`${sec(step.at)} に緊急タスクの通知が来て、箱を打ち切った。`);
      why.push('緊急タスクは優先度が最も高く、スラックがない。要求時刻ちょうどに始める必要がある。');
      result.push(`始まっていない固定タスク ${step.removed.length} 件をキューへ戻した。次の箱は緊急タスクを軸に組み直す。`);
      break;
  }
  return { did, why, result };
}

// ---- the life of one target (chapter 1, part 1)
export interface LifeEvent { t: Us; state: 0 | 1 | 2; title: string; body: string }

export function lifeOf(sim: SimResult, target: number): LifeEvent[] {
  const ev: LifeEvent[] = [{ t: 0, state: 0, title: 'まだ見つかっていない', body: '捜索のビームがこの目標のいる方向を通るまで、レーダは何も知りません。' }];
  const P = sim.scenario.params;
  type Item = { t: Us; order: number; make: () => LifeEvent };
  const items: Item[] = [];
  for (const m of sim.marks) {
    if (m.target !== target) continue;
    if (m.kind === 'detect') items.push({ t: m.t, order: 0, make: () => ({ t: m.t, state: 1, title: '捜索で探知した ◆',
      body: `本物かどうかはまだ分かりません。${msTxt(P.confirmDelay)} 後に確認照射を1回頼みます。これが最初の「固定タスク」です。` }) });
    if (m.kind === 'lost') items.push({ t: m.t, order: 2, make: () => ({ t: m.t, state: 0, title: '追尾を失った（ロスト）',
      body: `${P.missLimit} 回続けて当たらなかったので、航跡を捨てます。次に捜索で見つかるまで、また何も分かりません。` }) });
  }
  for (const q of sim.requests) {
    if (q.target !== target) continue;
    if (q.status === 'done') {
      const at = q.start! + q.len;
      const shift = q.start! - q.req, moved = Math.abs(shift) < 500 ? '要求時刻どおり' : `要求時刻より ${msTxt(Math.abs(shift))} ${shift < 0 ? '早く' : '遅く'}`;
      if (q.kind === 'confirm') items.push({ t: at, order: 1, make: () => ({ t: at, state: q.hit ? 2 : 0, title: q.hit ? '確認照射が命中、追尾を開始' : '確認照射が外れた ✕',
        body: q.hit ? `ここから定期的な追尾更新が始まります。次の更新は、いま照射した時刻の ${msTxt(sim.scenario.targets[target].high ? P.intervalHigh : P.intervalNormal)} 後に頼みます。` : '確認できなかったので、未探知に戻ります。次に捜索で見つかるのを待ちます。' }) });
      else if (q.hit) items.push({ t: at, order: 1, make: () => ({ t: at, state: 2, title: q.kind === 'retry' ? '再照射が命中' : '追尾更新が命中',
        body: `${moved}に実行されました。次の更新は、実際に照射した時刻を起点に頼みます。` }) });
      else items.push({ t: at, order: 1, make: () => ({ t: at, state: 2, title: (q.kind === 'retry' ? '再照射' : '追尾更新') + 'が外れた ✕',
        body: `すぐに取り返すため、${msTxt(P.retryDelay)} 後に再照射を頼みます。${P.missLimit} 回続けて外すとロストです。` }) });
    } else if (q.status === 'dropped') {
      const at = q.resolvedAt!;
      items.push({ t: at, order: 1, make: () => ({ t: at, state: q.kind === 'confirm' ? 0 : 2, title: `${KIND[q.kind]}を取りこぼした ✕`,
        body: `許容範囲のうちに順番が回ってきませんでした（${DROP[q.dropReason!]}）。外れ1回と同じ扱いになります。` }) });
    }
  }
  items.sort((a, b) => a.t - b.t || a.order - b.order);
  for (const it of items) ev.push(it.make());
  return ev;
}
export const STATES = ['未探知', '確認中', '追尾中'];
