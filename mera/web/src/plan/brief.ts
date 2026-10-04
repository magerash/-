// Plain-language brief -> building program. Deterministic, bilingual (EN / RU) and fully
// explainable: every item records the words it came from, and anything not understood is
// reported back instead of silently guessed.
import type { BuildType, Program, ProgramItem, SiteElement, Zone } from '../types';
import { CATALOG } from './catalog';

const TYPE_WORDS: [BuildType, RegExp][] = [
  ['guesthouse', /guest ?house|guest cabin|гостев\w* (?:дом\w*|домик\w*)|гостевой/],
  ['carport', /carport|car port|навес\w* (?:для|под) (?:машин|авто)\w*|навес\w*/],
  ['garage', /garage|гараж\w*/],
  ['sauna', /sauna|banya|bath ?house|бан[яиюеь]\w*|баньк\w*|саун\w*/],
  ['greenhouse', /greenhouse|glasshouse|теплиц\w*|оранжере\w*/],
  ['workshop', /workshop|мастерск\w*/],
  ['shed', /shed|storage|utility|хозблок\w*|сара[йяе]\w*|бытовк\w*|кладов\w*/],
  ['gazebo', /gazebo|pavilion|pergola|беседк\w*|альтанк\w*/],
  ['pool', /pool|swimming|бассейн\w*/],
  ['garden', /vegetable|kitchen garden|veg patch|beds|огород\w*|грядк\w*/],
  ['parking', /parking|car park|парковк\w*|стоянк\w*/],
  ['playground', /play ?ground|play area|детск\w* площадк\w*|площадк\w* для детей/],
  ['terrace', /terrace|deck|patio|террас\w*|настил\w*|патио/],
  ['house', /house|home|cottage|dwelling|дом\w*|коттедж\w*|избу|изба/],
];

const ZONES: [Zone, RegExp][] = [
  ['forest', /(?:near|by|next to|close to|towards?|at|along|beside|facing) (?:the )?(?:forest|woods?|trees)|(?:at|in) the (?:back|rear|far end)|back of the (?:plot|site|land)|у леса|возле леса|ближе к лесу|рядом с лесом|к лесу|около леса|в глубине|сзади|в конце участка|у задн\w* границ\w*/],
  ['road', /(?:near|by|next to|close to|at|along|beside|facing) (?:the )?(?:road|street|entrance|gate|front)|(?:at|in) the front|у дороги|возле дороги|ближе к дороге|рядом с дорогой|у въезда|возле въезда|у ворот|возле ворот|спереди|у улицы|вдоль дороги/],
  ['corner', /corner|в углу|уголк\w*|угол\w*/],
  ['center', /middle|cent(?:er|re)|посередин\w*|в центре|по центру/],
  ['left', /\bleft\b|слева|левой|левую|левом/],
  ['right', /\bright\b|справа|правой|правую|правом/],
];

const NEAR_HOUSE = /(?:next to|near|by|beside|attached to|close to) (?:the )?house|рядом с домом|у дома|возле дома|около дома|пристро\w*/;
const NUM_WORDS: Record<string, number> = {
  one: 1, single: 1, a: 1, an: 1, two: 2, double: 2, three: 3, один: 1, одна: 1, одну: 1, два: 2, две: 2, пара: 2, три: 3,
};

function storeysOf(s: string): number | null {
  if (/three[- ]?stor(?:e?y|ies)|3[- ]?stor(?:e?y|ies)|трехэтажн|трёхэтажн|3[- ]?х? ?этаж|три этажа/.test(s)) return 3;
  if (/two[- ]?stor(?:e?y|ies)|2[- ]?stor(?:e?y|ies)|double[- ]stor|двухэтажн|двух этажн|2[- ]?х? ?этаж|два этажа|в два этажа/.test(s)) return 2;
  if (/attic|mansard|loft|мансард/.test(s)) return 1.5;
  if (/(?:one|single|1)[- ]?stor(?:e?y|ies)|bungalow|одноэтажн|один этаж|1[- ]?этаж/.test(s)) return 1;
  return null;
}

function sizeOf(s: string): { w: number; d: number } | { area: number } | null {
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:x|х|×|\*|by|на)\s*(\d+(?:[.,]\d+)?)/);
  if (m) {
    const a = parseFloat(m[1].replace(',', '.'));
    const b = parseFloat(m[2].replace(',', '.'));
    if (a > 0.5 && b > 0.5 && a < 60 && b < 60) return { w: Math.max(a, b), d: Math.min(a, b) };
  }
  const ar = s.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|sq\.? ?m|sqm|square met|м2|м²|кв\.? ?м|квадрат)/);
  if (ar) return { area: parseFloat(ar[1].replace(',', '.')) };
  return null;
}

function countOf(s: string, typeWord: string): number {
  const before = s.slice(0, Math.max(0, s.indexOf(typeWord))).trim().split(/\s+/).slice(-2);
  for (const w of before.reverse()) {
    if (/^\d+$/.test(w)) return Math.min(4, Math.max(1, parseInt(w, 10)));
    if (w in NUM_WORDS && NUM_WORDS[w] > 1 && !/stor|этаж/.test(s.slice(s.indexOf(w), s.indexOf(typeWord)))) return NUM_WORDS[w];
  }
  return 1;
}

const KEEP_RX = /keep|retain|preserve|leave|сохран\w*|оставит\w*|оставь\w*|не трогать/;
const CLEAR_RX = /remove|demolish|tear down|clear|get rid|replace|снест\w*|снести|убрат\w*|убери|демонтир\w*|разобрат\w*|заменит\w*/;
const KIND_WORDS: [SiteElement['kind'], RegExp][] = [
  ['house', /existing house|old house|the house|дом\w*/],
  ['sauna', /sauna|banya|бан[яиюе]\w*|баньк\w*/],
  ['shed', /sheds?|cabins?|сара\w*|бытовк\w*|хозблок\w*/],
  ['greenhouse', /greenhouse|теплиц\w*/],
  ['beds', /beds|garden|грядк\w*|огород\w*/],
  ['tree', /trees?|дерев\w*/],
  ['trampoline', /trampoline|батут\w*/],
];

const STOP = new Set(['a', 'an', 'the', 'some', 'we', 'want', 'need', 'i', 'would', 'like', 'to', 'build', 'add', 'put', 'place', 'new',
  'хочу', 'хотим', 'нужно', 'нужен', 'нужна', 'построить', 'поставить', 'добавить', 'сделать', 'надо', 'мы', 'я', 'еще', 'новый', 'новую', 'новое', 'там', 'тут', 'здесь']);

let seq = 0;
const uid = (t: string) => `${t}-${++seq}`;

export function parseBrief(text: string, existing: SiteElement[]): Program {
  const prog: Program = { items: [], keep: [], clear: [], notes: [], unparsed: [] };
  const src = text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  if (!src) return prog;
  const groups = src.split(/[,;.\n]+|\bthen\b|\bplus\b|\balso\b|\bа также\b|\bа еще\b|\bтакже\b/).map((g) => g.trim()).filter(Boolean);
  for (const g of groups) {
    // keep / clear instructions about existing structures
    const keep = KEEP_RX.test(g);
    const clear = CLEAR_RX.test(g);
    if (keep || clear) {
      let hit = false;
      for (const [kind, rx] of KIND_WORDS) {
        if (!rx.test(g)) continue;
        const ids = existing.filter((e) => e.kind === kind).map((e) => e.id);
        if (ids.length) {
          (clear ? prog.clear : prog.keep).push(...ids);
          prog.notes.push(`${clear ? 'Clear' : 'Keep'} existing ${kind === 'beds' ? 'garden beds' : kind + (ids.length > 1 ? 's' : '')} (${ids.length})`);
          hit = true;
        }
      }
      if (hit && !/new|build|add|постро|нов|добав|постав/.test(g)) continue;
    }
    // JS \b is ASCII-only, so Russian conjunctions are matched by surrounding whitespace
    const parts = g.split(/(?:^|\s)(?:and|и|да еще|а)(?=\s|$)|&|\+/).map((p) => p.trim()).filter(Boolean);
    const groupItems: ProgramItem[] = [];
    let groupZones: Zone[] = [];
    for (const part of parts) {
      const zones = ZONES.filter(([, rx]) => rx.test(part)).map(([z]) => z);
      // the head noun comes first: "a house with a terrace" is a house, "a guest house" a guest house
      let typeHit: [BuildType, RegExp] | undefined;
      let best = Infinity;
      for (const tw of TYPE_WORDS) {
        const m = part.match(tw[1]);
        if (m && m.index! < best) { best = m.index!; typeHit = tw; }
      }
      if (!typeHit) {
        if (zones.length && groupItems.length) {
          for (const it of groupItems) if (it.zone === 'any') { it.zone = zones[0]; it.zone2 = zones[1]; }
          groupZones = zones;
        } else if (part.split(' ').filter((t) => !STOP.has(t)).join('').length > 2) {
          prog.unparsed.push(part);
        }
        continue;
      }
      const [type, rx] = typeHit;
      const word = part.match(rx)![0];
      if ((type === 'house' || type === 'guesthouse') && /terrace|deck|veranda|террас|веранд/.test(part))
        prog.notes.push('Terrace / veranda noted as part of the house footprint.');
      const spec = CATALOG[type];
      const storeysRaw = storeysOf(part);
      const storeys = spec.storeyHeight === 0 ? 1 : Math.round(storeysRaw ?? 1) || 1;
      let w = spec.w;
      let d = spec.d;
      const size = sizeOf(part);
      let sizeFromBrief = false;
      if (size && 'w' in size) { w = size.w; d = size.d; sizeFromBrief = true; }
      else if (size && 'area' in size) {
        const fp = type === 'house' || type === 'guesthouse' ? size.area / Math.max(1, storeysRaw ?? 1) : size.area;
        const k = Math.sqrt(fp / (spec.w * spec.d));
        w = +(spec.w * k).toFixed(1); d = +(spec.d * k).toFixed(1); sizeFromBrief = true;
      } else if (/small|little|tiny|compact|маленьк|небольш|компактн/.test(part)) { w = +(w * 0.8).toFixed(1); d = +(d * 0.8).toFixed(1); }
      else if (/large|big|spacious|больш|просторн/.test(part)) { w = +(w * 1.25).toFixed(1); d = +(d * 1.25).toFixed(1); }
      if (type === 'garage' && /double|two[- ]car|2[- ]car|на две|на 2|двухместн/.test(part)) { w = 7; d = 6.5; }
      if (type === 'house' && storeys === 2 && !sizeFromBrief) { w = 9; d = 8; }
      const n = type === 'garden' || type === 'parking' ? 1 : countOf(part, word);
      for (let k = 0; k < n; k++) {
        const it: ProgramItem = {
          id: uid(type), type, label: spec.label + (storeysRaw === 1.5 ? ' with attic' : storeys > 1 ? ` · ${storeys} storeys` : ''),
          storeys: storeysRaw === 1.5 ? 1.5 : storeys, w, d,
          zone: zones[0] ?? 'any', zone2: zones[1], sizeFromBrief, phrase: part,
        };
        if (NEAR_HOUSE.test(part) && type !== 'house') it.near = 'house';
        groupItems.push(it);
      }
      if (zones.length) groupZones = zones;
    }
    // English/Russian lists put the location once at the end: "a garage and a sauna by the road"
    for (const it of groupItems) if (it.zone === 'any' && groupZones.length) { it.zone = groupZones[0]; it.zone2 = groupZones[1]; }
    prog.items.push(...groupItems);
  }
  for (const it of prog.items) {
    if (it.zone === 'any' && CATALOG[it.type].defaultZone !== 'any') {
      it.zone = CATALOG[it.type].defaultZone;
      prog.notes.push(`${CATALOG[it.type].label}: no location given, placed by default ${it.zone === 'road' ? 'near the entrance (vehicle access)' : 'in the open centre'}.`);
    }
    if (it.near === 'house') {
      const h = prog.items.find((x) => x.type === 'house');
      it.near = h ? h.id : existing.find((e) => e.kind === 'house')?.id;
    }
  }
  const existingSauna = existing.some((e) => e.kind === 'sauna');
  if (existingSauna && prog.items.some((i) => i.type === 'sauna') && !prog.clear.some((id) => existing.find((e) => e.id === id)?.kind === 'sauna'))
    prog.notes.push('There is already a sauna on the plot. The new one is added; say "replace the sauna" to clear the old one.');
  const existingHouse = existing.some((e) => e.kind === 'house');
  if (existingHouse && prog.items.some((i) => i.type === 'house') && !prog.clear.some((id) => existing.find((e) => e.id === id)?.kind === 'house'))
    prog.notes.push('The existing house is kept. Say "replace the house" to free its footprint.');
  if (!prog.items.length) prog.notes.push('No buildings recognised. Try e.g. "a two-storey house near the forest, a garage and a sauna by the road".');
  return prog;
}

export function describeZone(z: Zone | undefined): string {
  switch (z) {
    case 'forest': return 'near the forest';
    case 'road': return 'by the road';
    case 'entrance': return 'by the entrance';
    case 'center': return 'in the middle';
    case 'left': return 'left side';
    case 'right': return 'right side';
    case 'corner': return "in the owner's corner";
    default: return 'anywhere';
  }
}
