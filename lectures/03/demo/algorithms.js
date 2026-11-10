'use strict';

const HIGH = 25;
const RADIUS = 1;
const LAG = 5;
const DAY_LENGTH = 30;
const DOMAIN_AREA = 18;
const TYPES = ['A', 'B', 'C'];

function extractEvents(sites, rows) {
  const previous = new Map();
  const events = [];
  for (const {day, minute, values} of rows) {
    sites.forEach(({id, x, y}, index) => {
      const key = day + id;
      const value = values[index];
      if ((previous.get(key) ?? 0) < HIGH && value >= HIGH) {
        events.push({day, minute, site: id, kind: id[0], x, y, value, key:`${key}:${minute}`});
      }
      previous.set(key, value);
    });
  }
  return events;
}

function align(x, y) {
  const costs = Array.from({length:x.length + 1}, () => Array(y.length + 1).fill(Infinity));
  const cells = [];
  costs[0][0] = 0;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const predecessors = [
        {i:i-1, j:j-1, direction:'左上'},
        {i:i-1, j, direction:'上'},
        {i, j:j-1, direction:'左'}
      ].map(p => ({...p, value:costs[p.i][p.j]}));
      const parent = predecessors.reduce((best, p) => p.value < best.value ? p : best);
      const local = Math.abs(x[i-1] - y[j-1]);
      const value = local + parent.value;
      costs[i][j] = value;
      cells.push({i,j,local,value,parent,predecessors});
    }
  }
  const path = [];
  let i = x.length, j = y.length;
  while (i > 0 && j > 0) {
    const cell = cells[(i-1)*y.length+j-1];
    path.push(cell);
    ({i,j} = cell.parent);
  }
  return {cells,path,distance:costs[x.length][y.length]};
}

function project(logs, prefix) {
  return logs.map(({day, events}) => {
    let next = 0;
    const matched = [];
    for (const kind of prefix) {
      const index = events.findIndex((event, i) => i >= next && event.kind === kind);
      if (index === -1) return {day, events, matched:[], suffix:[], found:false};
      matched.push(index);
      next = index + 1;
    }
    return {day, events, matched, suffix:events.slice(next), found:true};
  });
}

function supportingDays(rows, nextKind) {
  return rows.filter(row => row.found && row.suffix.some(event => event.kind === nextKind))
    .map(row => row.day);
}

function distance(a, b) {
  return Math.hypot(a.x-b.x,a.y-b.y);
}

function participation(instances, types, active) {
  const ratios = types.map(kind => {
    const total = active.filter(p => p.id[0] === kind).length;
    const selected = [...new Set(instances.flat().filter(p => p.id[0] === kind).map(p => p.id))];
    return {kind,total,selected,ratio:total ? selected.length/total : 0};
  });
  return {ratios, pi: Math.min(...ratios.map(row => row.ratio))};
}

function colocation(active, radius) {
  const near = (a,b) => distance(a,b) <= radius + 1e-9;
  const groups = Object.fromEntries(TYPES.map(kind => [kind, active.filter(p => p.id[0] === kind)]));
  const pairs = [['A','B'],['A','C'],['B','C']].map(kinds => {
    const [left,right] = kinds.map(kind => groups[kind]);
    const instances = left.flatMap(a => right.filter(b => near(a,b)).map(b => [a,b]));
    return {label:kinds.join(''),instances,...participation(instances,kinds,active)};
  });
  const stars = groups.A.flatMap(a => groups.B.filter(b => near(a,b)).flatMap(
    b => groups.C.filter(c => near(a,c)).map(c => [a,b,c])
  ));
  const cliques = stars.filter(([,b,c]) => near(b,c));
  return {pairs,stars,cliques,upper:participation(stars,TYPES,active),full:participation(cliques,TYPES,active)};
}

function extend(sources, targets, dayCount) {
  const volume = (2*RADIUS)**2*LAG;
  const domain = DOMAIN_AREA*DAY_LENGTH*dayCount;
  const comparisons = sources.flatMap(a => targets.map(b => {
    const delta = b.minute-a.minute;
    const spatial = Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
    const pass = a.day === b.day && delta > 0 && delta <= LAG && spatial <= RADIUS+1e-9;
    return {a,b,delta,spatial,pass};
  }));
  const matches = comparisons.filter(pair => pair.pass);
  const tails = [...new Map(matches.map(({b}) => [b.key,b])).values()];
  const localVolume = sources.length*volume;
  const dr = localVolume && targets.length
    ? (matches.length/localVolume)/(targets.length/domain) : 0;
  return {sources,targets,comparisons,matches,tails,volume,domain,localVolume,dr};
}
