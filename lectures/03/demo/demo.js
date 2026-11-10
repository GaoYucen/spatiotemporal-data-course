'use strict';

const byId = id => document.getElementById(id);
const {sites,counts} = trafficData;
const events = extractEvents(sites,counts);
const days = [...new Set(counts.map(r => r.day))];
const times = [...new Set(counts.map(r => r.minute))];
const logs = days.map(day => ({day,events:events.filter(event => event.day === day)}));
const kinds = Object.fromEntries(TYPES.map(kind => [kind,events.filter(e => e.kind === kind)]));
const series = day => counts.filter(row => row.day === day).map(row => row.values[0]);
const x = series('D1'), y = series('D2');
const dtw = align(x,y);
const active = sites.filter(site => events.some(event => event.site === site.id));
const join = colocation(active,RADIUS), shortJoin = colocation(active,0.5);
const ab = extend(kinds.A,kinds.B,days.length);
const abc = extend(ab.tails,kinds.C,days.length);
const ac = extend(kinds.A,kinds.C,days.length);
const minDays = 2, minPI = 0.5, minSI = 10;

const status = (text,style='') => `<span class="badge ${style}">${text}</span>`;
const table = (headers,rows,extra='') => `<div class="data-table"><table class="${extra}"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(([head,...rest]) => `<tr><th scope="row">${head}</th>${rest.map(cell => typeof cell === 'object' ? `<td class="${cell.style}">${cell.text}</td>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const note = text => `<p class="caption">${text}</p>`;
const line = text => `<p class="chain">${text}</p>`;
const label = e => `${e.day} · ${e.site} · ${e.minute} 分`;
const kindText = list => list.map(e => e.kind).join(' → ') || '空';
const number = value => Number.isFinite(value) ? String(value) : '∞';
const km = value => Number(value.toFixed(2));
const step = (title,explain,calc,question,answer) => ({title,explain,calc,question,answer});
const projection = prefix => project(logs,prefix);

function curveDiagram() {
  const xPos = i => 80+i*108;
  const yPos = value => 113-(value-10)*3.2;
  const points = values => values.map((v,i) => xPos(i)+','+yPos(v)).join(' ');
  const markers = (values, color) => values.map((v,i) =>
    `<circle cx="${xPos(i)}" cy="${yPos(v)}" r="4" fill="${color}"/>`).join('');
  return `<svg viewBox="0 0 680 158" role="img" aria-label="A1 两天的车辆数曲线。D1 在第 2、3 点为 30，D2 在第 3 点为 30，其他点为 10。">
    <text class="muted-text" x="17" y="53">30</text><text class="muted-text" x="17" y="118">10</text>
    <line class="line" x1="48" y1="49" x2="650" y2="49"/><line class="line" x1="48" y1="113" x2="650" y2="113"/>
    <polyline points="${points(x)}" fill="none" stroke="#08624f" stroke-width="3"/>
    <polyline points="${points(y)}" fill="none" stroke="#1f4f87" stroke-width="3" stroke-dasharray="6 4"/>
    ${markers(x,'#08624f')}${markers(y,'#1f4f87')}
    ${times.map((t,i)=>`<text class="muted-text" x="${xPos(i)}" y="136" text-anchor="middle">${t} 分</text>`).join('')}
    <text class="muted-text" x="340" y="18" text-anchor="middle">D1 绿色实线　　D2 蓝色虚线</text>
    </svg>`;
}

function dtwDiagram(stepIndex) {
  const filled = Math.min(stepIndex,dtw.cells.length);
  const backCount = Math.max(0,stepIndex-dtw.cells.length);
  const trace = dtw.path.slice(0,backCount);
  const current = backCount ? dtw.path[backCount-1] : dtw.cells[filled-1];
  const inPath = (i,j) => trace.some(p => p.i === i && p.j === j);
  const isPrevious = (i,j) => current?.predecessors.some(p => p.i === i && p.j === j);
  const grid = x.map((a,r) => [`D1-${r+1} · ${a}`,...y.map((b,c) => {
    const i=r+1, j=c+1;
    const index=r*y.length+c;
    const isCurrent = current?.i === i && current?.j === j;
    let style = '';
    if (isCurrent) style = 'current';
    else if (inPath(i,j)) style = 'path';
    else if (!backCount && isPrevious(i,j)) style = 'compared';
    const direction = {'左上':'↖','上':'↑','左':'←'}[dtw.cells[index].parent.direction];
    const text = index < filled
      ? `${dtw.cells[index].value}${isCurrent && index > 0 ? ` <small aria-label="来路">${direction}</small>` : ''}`
      : '·';
    return {style,text};
  })]);
  let caption = '空表。每个格子代表把 D1 的一个采样点和 D2 的一个采样点配起来。';
  if (filled && !backCount) caption = '黄色是本步填的格，蓝色是参与比较的已算来路。箭头指向选中的来路。';
  if (backCount) caption = '绿色是已回溯的配对，黄色是当前所在格。下方坐标按倒走顺序排列。';
  const values = `<div class="small">A1 原始计数（辆 / 5 分钟）<br>D1：${x.join(' · ')}<br>D2：${y.join(' · ')}</div>`;
  const trail = trace.length
    ? line(trace.map(({i,j}) => `(${i},${j})`).join(' → ')) : '';
  return values + (stepIndex === 0 ? curveDiagram() : '') + table(['累计代价',...y.map((b,c) => `D2-${c+1} · ${b}`)],grid,'matrix') + note(caption) + trail;
}

function dtwInfo(index) {
  if (index === 0) return step('先看两条原始曲线','两天都先低、再高、再低，但高点占的采样格不一样。DTW 把两天的采样点配成对，允许一边暂时停在同一个点。','本例每配一对，代价 = 两个车流值的绝对差。按相同索引逐点比较，总差为 20。','两天的第 2 点分别是多少？','D1 是 30，D2 是 10。把它们硬配在一起要付出 20。');
  if (index <= dtw.cells.length) {
    const cell = dtw.cells[index-1];
    const {i,j,local,value,predecessors,parent} = cell;
    const incoming = ['上','左','左上'].map(direction => predecessors.find(p => p.direction === direction));
    return step(`填第 ${i} 行、第 ${j} 列`,
      '先算这一对数值的差，再在上、左、左上三个来路中找累计代价最小的。虚拟第 0 行和第 0 列只有 (0,0) 是 0，其他位置都是 ∞。',
      `<p>本格差值：|${x[i-1]} − ${y[j-1]}| = <b>${local}</b></p><p>上 / 左 / 左上：${incoming.map(p => number(p.value)).join(' / ')}</p><p>D(${i},${j}) = ${local} + ${number(parent.value)} = <b>${value}</b>，记下来路 ${parent.direction}。</p>`,
      '表里记的是这一对数值的差，还是从起点走到这里的最低总代价？','表里记最低累计代价。当前这对的差值，只是最后加上去的一项。');
  }
  const k = index-dtw.cells.length-1;
  const cell = dtw.path[k];
  const {i,j,parent} = cell;
  const first = k === 0, last = k === dtw.path.length-1;
  return step(first ? '从右下角开始回溯' : last ? '回到左上角，读出完整配对' : `倒走到 (${i},${j})`,
    first ? '右下格是最小总代价。现在倒着走，每一步沿填表时留下的来路。'
      : last ? '把回溯顺序反过来，就是从第一个采样点到最后一个采样点的配对。'
      : '记录当前配对，再沿这一格的最优来路继续往回走。斜着走两边一起退，横竖走只有一边退。',
    `<p>D1 第 ${i} 点 ${x[i-1]} ↔ D2 第 ${j} 点 ${y[j-1]}。</p>` +
    (last ? `<p>DTW 累计代价 = <b>${dtw.distance}</b>。D1 的第 2、3 点都配给 D2 的第 3 点。</p>`
      : `<p>本格的来路：${parent.direction} (${parent.i},${parent.j})。${first ? ' DTW 累计代价 = '+dtw.distance+'。' : ''}</p>`),
    '横走或竖走为什么有用？','让一边留在同一个采样点，另一边跨过多一个时刻，就能匹配长短不同的高峰。');
}

const prefixStages = [
  {prefix:'',next:'', info:step('先把事件按日排成日志','输入是四份按时间排好的事件类型序列。D1 和 D2 都按 A、B、C 的顺序发生。这里比较顺序，可以隔着别的事件。','最低支持度设为 2/4。计数单位是日期。','D3 有 A 和 B，它也包含 A→B 吗？','没有。D3 是 B 先、A 后。')},
  {prefix:'A',next:'',info:step('先匹配 A，把日志投影到 A 之后','先在每份日志里找 A，再把 A 后面还能用的片段留下。D3 找到了 A，但它后面没有内容。D4 没有 A。','A 出现在 3 天，所以前缀 A 可以扩展。','D3 的 B 为什么被划出本步的后缀？','B 发生在 A 之前，向 A 后接事件时不能用它。')},
  {prefix:'A',next:'B',info:step('在 A 的剩余片段里找 B','逐日检查剩余片段中有没有 B。D1、D2 各贡献一天，组成新的频繁前缀 AB。','支持度(A→B) = 2 个命中日 ÷ 原库 4 天 = 2/4。','为什么分母仍是四天？','投影只缩小搜索范围。支持度始终按原始日志库计。')},
  {prefix:'AB',next:'C',info:step('匹配 AB，再从它后面找 C','换成前缀 AB 后，D1、D2 各剩一个 C。两天都能扩展为 ABC。','支持度(A→B→C) = 2/4，达到门槛。','D2 在这个步骤为什么通过？','三类事件的顺序正确。这个版本的 PrefixSpan 没有检查测点距离。')},
  {prefix:'ABC',next:'',info:step('到 ABC 后已经没有后缀','两份命中 ABC 的日志都读到了结尾，所以这个前缀无法再增长。','ABC 已达标。它的后续扩展得到 0 天支持。','后缀为空，是不是说明这一天没有匹配到 ABC？','这一天已经匹配到 ABC，只是没有剩余事件用于继续扩展。')},
  {prefix:'B',next:'A',info:step('回到 B 分支，剪掉 B→A','换一个开头。B 后面有 A 的只有 D3，所以 BA 不够频繁，整条 BA 分支停止。','支持度(B→A) = 1/4，低于 2/4。所有以 BA 开头的更长序列也至多命中这一天。','既然 BA 停了，B 开头的其他分支也要停吗？','BA 这条分支停。比如 BC 仍可独立检查，D1 和 D2 都有。')}
];

function prefixDiagram(index) {
  const {prefix,next} = prefixStages[index];
  const rows = projection(prefix);
  const hit = next ? supportingDays(rows,next) : [];
  const logTable = table(['日期','原日志（类型与分钟）','剩余片段','本步贡献'],rows.map(row => {
    const before = row.matched.length ? row.matched.at(-1) : -1;
    const tokens = row.events.map((e,i) => {
      const style = !row.found ? 'dim' : row.matched.includes(i) ? 'compared' : i < before ? 'dim' : next === e.kind ? 'good' : '';
      return status(`${e.kind} · ${e.minute} 分`,style);
    }).join(' ');
    const suffix = !prefix ? '整份日志' : row.found ? kindText(row.suffix) : '无此开头';
    return [row.day,tokens,suffix,next ? (hit.includes(row.day) ? status('命中','good') : '—') : row.found && prefix ? '前缀命中' : '—'];
  }));
  return line(prefix ? `当前前缀 ${[...prefix].join(' → ')}${next ? '　｜　尝试接 '+next : ''}` : '每行是一份独立的日内日志') + logTable +
    note(prefix ? '蓝色是已匹配的前缀，绿色是当前要接的后件。每一天最多给一次支持。' : '同一天内按发生时刻排序。日期只负责划分日志。') +
    (next ? line(`支持度 ${hit.length}/${days.length}　${hit.length >= minDays ? '达到门槛' : '低于门槛，停止扩展'}`) : '');
}

const joinSteps = [
  step('一张地图，先去掉重复的测点','整个观察期内，有过高流量事件的测点各保留一份坐标。A1 出现过两天，在这张图里也只放一个点。','输入是 6 个不同测点。每类有 2 个。空间邻接门槛为 1 km。','Joinless 这一步按天数，还是按测点数？','按不同测点计数。日期用来限定观察期。'),
  step('先检查两个类型能否共位','逐类查不同类型的邻居。AB、AC、BC 的覆盖都达到 0.50，所以 ABC 通过类型子集检查。','PI 取各类型参与率的最小值。先记住：这一步的两类型实例允许出现在不同的地方。','有 AB、AC、BC，就一定能找到一组三点彼此都相邻吗？','不一定。三种配对可能来自不同的测点组合。'),
  step('以 A 为中心，组合星型候选','逐个查 A 的 B 类、C 类邻居。只要 A 身边同时有 B 和 C，就先记为一个星型。','两个 A 各找到一个星型。此时暂时只检查 A—B 和 A—C。','组成星型时，哪一条边还没有检查？','B—C 这条外围边。'),
  step('算星型 PI 上界','所有完整实例都必须先满足中心两条边，所以完整实例里的参与对象，不会比星型里的更多。','每类都有 2 个对象出现在星型里，上界 = min(2/2, 2/2, 2/2) = 1.00。上界达到 0.50，要继续验边。','星型 PI 是 1.00，完整 PI 就一定是 1.00 吗？','上界是乐观估计，验完外围边还可能减少参与对象。'),
  step('检查外围 B—C，剔除一个星型','对每个星型检查之前漏掉的边。B1—C1 相距 0.4 km，通过。B2—C2 相距 1.6 km，超出 1 km。','保留 A1、B1、C1。剔除 A2、B2、C2。','这里剔除的是整个 ABC 模式，还是它的一组具体对象？','这里只剔除第二组具体对象。第一组仍然是 ABC 的有效实例。'),
  step('只用完整实例计算 PI','分母是全期出现过的各类测点总数，分子是至少参加一个完整实例的不同测点数。','PI(ABC) = min(1/2, 1/2, 1/2) = 0.50，刚好达到门槛。','PI 0.50 指的是有一半的日子出现 ABC 吗？','它指各类参与率中最低的一个是 0.50。单位是测点覆盖比例。'),
  step('同一原表，距离收紧后怎样提前剪枝？','把空间门槛从 1 km 改成 0.5 km，参与指数门槛仍为 0.50。先重做两类型检查。','AC 找不到任何邻接对，PI(AC) = 0。任何三点完整共位都必须包含一条 AC 边，因此这次 ABC 在生成星型前就被剪掉。','ABC 为什么可以跳过星型和外围验证？','已经知道它必须包含的 AC 子集不达标。')
];

function siteMap(index) {
  const edges = new Map();
  const add = (a,b,style) => edges.set([a.id,b.id].sort().join('-'),{a,b,style});
  if (index === 1 || index === 6) {
    const result = index === 6 ? shortJoin : join;
    result.pairs.forEach(pair => pair.instances.forEach(([a,b]) => add(a,b,'active-edge')));
  }
  if (index >= 2 && index <= 5) {
    const shown = index === 5 ? join.cliques : join.stars;
    shown.forEach(([a,b,c]) => {
      add(a,b,'active-edge');
      add(a,c,'active-edge');
      if (index >= 4) add(b,c,distance(b,c) <= RADIUS+1e-9 ? 'active-edge' : 'failed-edge');
    });
  }
  const position = site => 30+(site.x-0.6)*95;
  const arc = ({a,b,style}) => {
    const start=position(a), end=position(b), peak=79-Math.abs(start-end)*0.63;
    return `<path class="${style}" d="M${start},90 Q${(start+end)/2},${peak} ${end},90"/>`;
  };
  return `<svg viewBox="0 0 680 159" role="img" aria-label="六测点按里程排列。横线上的点为测点，上方连线表示本步检查的邻接关系。">
    <line class="line" x1="31" y1="90" x2="651" y2="90"/>
    ${[...edges.values()].map(arc).join('')}
    ${active.map(site => `<circle cx="${position(site)}" cy="90" r="5" fill="#08624f"/><text x="${position(site)}" y="117" text-anchor="middle">${site.id}</text><text class="muted-text" x="${position(site)}" y="140" text-anchor="middle">${site.x.toFixed(1)}</text>`).join('')}
    <text class="muted-text" x="670" y="140" text-anchor="end">km</text>
    </svg>`;
}

function joinDiagram(index) {
  let detail = '';
  if (index === 1 || index === 6) {
    const data = index === 6 ? shortJoin : join;
    detail = table(['类型组合','满足距离的测点对','PI','类型筛选'],data.pairs.map(pair => [
      pair.label,pair.instances.map(row => row.map(p => p.id).join('—')).join('、') || '无',pair.pi.toFixed(2),
      pair.pi >= minPI ? status('保留','good') : status('不达标','rejected')
    ]));
  } else if (index >= 2 && index <= 4) {
    const verify = index === 4;
    detail = table(['中心','A—B','A—C','B—C'],join.stars.map(([a,b,c]) => [
      a.id,`${b.id} · ${km(distance(a,b))} km`,`${c.id} · ${km(distance(a,c))} km`,
      verify ? `${km(distance(b,c))} km ${distance(b,c) <= RADIUS+1e-9 ? status('通过','good') : status('剔除','rejected')}` : '待验证'
    ]));
    if (index === 3) detail += line(`星型 PI 上界 ${join.upper.pi.toFixed(2)}　≥　门槛 ${minPI.toFixed(2)}`);
  } else if (index === 5) {
    detail = table(['类型','进入完整实例的测点','参与率'],join.full.ratios.map(row => [
      row.kind,row.selected.join('、'),`${row.selected.length}/${row.total}`
    ])) + line(`完整 PI = ${join.full.pi.toFixed(2)}　｜　ABC 保留`);
  }
  return siteMap(index) + note(index === 4 ? '实线通过，红色虚线未通过。下表列出每条边的数值。' :
    index >= 2 && index <= 3 ? '当前只画星型的中心边，B—C 留到外围验证。' : '横向位置按里程绘制，所有测点的纵坐标均为 0。') + detail;
}

const stsSteps = [
  step('同一张表，保留每次事件的日期、位置和时刻','一条边需要同时满足三件事：同一天，后件比前件晚且时差不超过 5 分钟，横纵坐标各相差不超过 1 km。','与 PrefixSpan 对照：D1 和 D2 都写成 ABC，但在这里还要逐对检查位置与时延。','时间顺序一样的两份日志，时空链也一定一样吗？','不一定。任一相邻步骤的空间距离超限，链就接不下去。'),
  step('逐对查 A→B，只有 D1 接得上','从三个 A 各找本日的 B。D2 虽然晚 5 分钟，横向相差 5.8 km。D3 的 B 先发生。','合格连接只有 D1 的 A1（5 分）→ B1（10 分）。','为什么 D2 的 B2 没有进入尾集合？','时间合格，但空间相差 5.8 km，超过 1 km。'),
  step('算第一步 DR，留下接上的 B1','把三个 A 的邻域都算进局部密度，包括没找到 B 的两个窗。再和背景 B 的密度比较。','<p>每窗 2 × 2 km² × 5 分 = 20 km²·分。</p><p>局部 1/(3×20)；背景 3/(18×30×4)。</p><p>DR(A→B) = (1/60) ÷ (3/2160) = <b>12</b>。</p>','能不能只用成功匹配的那个 A 窗作分母？','不能。这个步骤的起点是全部三个 A。只用成功窗会抬高局部密度。'),
  step('扩展 AB→C，只从尾事件继续','AB 的尾集合只有 D1 的 B1（10 分）。从它的邻域找到 D1 的 C1（15 分）。其余 B 没走完 AB，不能拿来扩展。','<p>现在有 1 个起点窗，局部密度 = 1/20。</p><p>DR(AB→C) = (1/20) ÷ (3/2160) = <b>36</b>。</p>','这一步为什么是一个窗，背景为什么仍有三个 C？','起点换成了 AB 的尾集合。背景仍用四天全部 C 事件。'),
  step('两步取最小，得到整条链的 SI','SI 看这条链最弱的一步。第一步 DR 是 12，第二步是 36，第二步的强度无法补偿第一步。','SI(A→B→C) = min(12,36) = <b>12</b>，超过门槛 10。实例来自 D1。','SI=12 代表出现了 12 次 ABC 吗？','它是密度比的最小值。这个例子里只匹配到一条完整事件链。'),
  step('试 A→C：前缀不达标，整支剪掉','从 A 直接找 C，没有一对能通过。D1 的 C1 在 A1 后 10 分钟，超过单步的 5 分钟限制。','SI(A→C) = 0，低于 10。停止搜索 A→C 开头的扩展。A→B→C 仍保留，它的前缀是 A→B。','为什么 A→C 不达标，A→B→C 仍然可以达标？','它们是两种检查：从 A 直接找 C，和先找 B 再从 B 找 C。每一步的 5 分钟单独计算。')
];

function stsDiagram(index) {
  const phase = index === 5 ? ac : index >= 3 ? abc : ab;
  const sources = new Set(phase.sources.map(e => e.key));
  const tails = new Set(phase.tails.map(e => e.key));
  const timeline = table(['日期',...times.map(t => `${t} 分`)],logs.map(log => [log.day,...times.map(t => {
    const event = log.events.find(e => e.minute === t);
    if (!event) return '·';
    const style = index === 0 ? '' : tails.has(event.key) ? 'good' : sources.has(event.key) ? 'compared' : 'dim';
    return {text:event.site,style};
  })]),'matrix');
  let detail = '';
  if (index === 1 || index === 3 || index === 5) {
    detail = table(['同日候选对','空间距离','晚几分钟','判定'],
      phase.comparisons.filter(({a,b}) => a.day === b.day).map(({a,b,spatial,delta,pass}) => {
        const why = [spatial>RADIUS+1e-9 ? '空间超限' : '',delta<=0 || delta>LAG ? '时差不合格' : ''].filter(Boolean).join('、');
        return [`${a.day} · ${a.site}→${b.site}`,`${km(spatial)} km`,delta,pass ? status('通过','good') : status(why,'rejected')];
      }));
  }
  if (index === 2 || index === 3) detail += line(`得到的尾事件：${phase.tails.map(label).join('、')}　｜　DR = ${phase.dr}`);
  if (index === 4) detail += line(`${label(ab.matches[0].a)} → ${label(ab.tails[0])} → ${label(abc.tails[0])}`);
  if (index === 5) detail += line(`A→C 合格连接 ${ac.matches.length} 条　｜　剪掉 AC 分支`);
  return timeline + note(index === 0 ? '每一行独立使用同一天的时间轴。' :
    '蓝色是本步实际查询的起点，绿色是这一步接上的尾事件。跨日候选直接排除。') + detail;
}

const methods = [
  {id:'dtw',tab:'DTW',title:'DTW 动态时间规整',subtitle:'同一测点 A1 的两天数值曲线 · 绝对差 · 填 36 格，再倒走最优路径',
    end:dtw.cells.length+dtw.path.length, info:dtwInfo, visual:dtwDiagram,
    stages:[[0,'原始曲线'],[1,'第一格'],[9,'示范格 (2,3)'],[dtw.cells.length,'填表完成'],[dtw.cells.length+1,'开始回溯'],[dtw.cells.length+dtw.path.length,'完整路径']]},
  {id:'prefix',tab:'PrefixSpan',title:'PrefixSpan 序列模式',subtitle:'四份日内日志 · 最小支持度 2/4 · 经典顺序匹配，允许跳过中间事件',
    end:prefixStages.length-1,info:i=>prefixStages[i].info,visual:prefixDiagram,
    stages:[[0,'每日序列'],[1,'投影 A'],[2,'匹配 B'],[3,'扩展 ABC'],[4,'结束分支'],[5,'剪掉 BA']]},
  {id:'join',tab:'Joinless',title:'Joinless 空间共位',subtitle:'观察期内的六个测点 · 默认欧氏距离 ≤1 km · 最小 PI 0.50',
    end:joinSteps.length-1,info:i=>joinSteps[i],visual:joinDiagram,
    stages:[[0,'测点'],[1,'两类型'],[2,'星型'],[3,'PI 上界'],[4,'外围验边'],[5,'完整 PI'],[6,'剪枝对照']]},
  {id:'sts',tab:'STS-Miner',title:'STS-Miner 时空事件序列',subtitle:'同日事件 · 各坐标相差 ≤1 km · 0 < 时差 ≤5 分钟 · 最小 SI 10',
    end:stsSteps.length-1,info:i=>stsSteps[i],visual:stsDiagram,
    stages:[[0,'事件时间轴'],[1,'匹配 A→B'],[2,'第一步 DR'],[3,'尾事件扩展'],[4,'整条链 SI'],[5,'剪掉 AC']]}
];

let method = methods[0];
const positionByMethod = Object.fromEntries(methods.map(m => [m.id,0]));
let selectedDay = days[0];
function buttons(target,items,callback) {
  target.replaceChildren(...items.map(([value,text]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = value;
    button.textContent = text;
    button.addEventListener('click',() => callback(value));
    return button;
  }));
}
function highlight(target,value) {
  target.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed',String(button.dataset.value === String(value)));
  });
}
function renderStep() {
  const index = positionByMethod[method.id];
  const info = method.info(index);
  byId('lab-title').textContent = method.title;
  byId('lab-subtitle').textContent = method.subtitle;
  byId('step-status').textContent = `第 ${index+1} / ${method.end+1} 步`;
  byId('lab').dataset.method = method.id;
  byId('lab').dataset.step = index;
  byId('visual').innerHTML = method.visual(index);
  byId('step-title').textContent = info.title;
  byId('step-explain').textContent = info.explain;
  byId('step-calc').innerHTML = info.calc;
  byId('question').textContent = '问：'+info.question;
  byId('answer').textContent = '答：'+info.answer;
  byId('prompt').open = false;
  byId('restart').disabled = index === 0;
  byId('previous').disabled = index === 0;
  byId('next').disabled = index === method.end;
  byId('next').textContent = index === method.end ? '本算法已完成' : '下一步 →';
  const phase = method.stages.findLast(([start]) => start <= index);
  highlight(byId('milestones'),phase[0]);
}
function moveTo(index) {
  positionByMethod[method.id] = Math.max(0,Math.min(method.end,index));
  renderStep();
}
function selectMethod(id) {
  method = methods.find(m => m.id === id);
  highlight(byId('methods'),id);
  buttons(byId('milestones'),method.stages,moveTo);
  renderStep();
}
function renderRaw() {
  highlight(byId('raw-days'),selectedDay);
  const highlights = logs.find(log => log.day === selectedDay).events;
  byId('raw-data').innerHTML = table(['分钟',...sites.map(s => s.id)],counts.filter(r => r.day === selectedDay).map(row => [
    row.minute,...row.values.map((value,i) => {
      const event = highlights.some(e => e.minute === row.minute && e.site === sites[i].id);
      return {text:event ? `${value} <small>↑</small>` : value,style:event ? 'good' : value >= HIGH ? 'compared' : ''};
    })
  ])) + note('绿色 ↑ 表示从低于 25 辆跨到至少 25 辆，计作一条事件。蓝色仍处于高位，延续同一次事件。') +
  line(selectedDay + ' 提取的事件：' + highlights.map(label).join(' → '));
}
byId('dataset-summary').textContent = `教学构造数据 · ${days.length} 天 · ${sites.length} 个测点 · ${counts.length*sites.length} 个计数 · ${events.length} 条高流量事件`;
buttons(byId('methods'),methods.map(m => [m.id,m.tab]),selectMethod);
buttons(byId('raw-days'),days.map(day => [day,day]),day => {selectedDay=day; renderRaw();});
byId('restart').addEventListener('click',() => moveTo(0));
byId('previous').addEventListener('click',() => moveTo(positionByMethod[method.id]-1));
byId('next').addEventListener('click',() => moveTo(positionByMethod[method.id]+1));
selectMethod('dtw');
renderRaw();
