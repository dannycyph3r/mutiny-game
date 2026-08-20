/* Shared accessibility sweep, used by both prototype audits. */
export const AUDIT = () => {
  const problems = [];
  const isHidden = (el) => {
    const s = getComputedStyle(el);
    // getClientRects is the ancestor-aware test: computed display is not
    // inherited, so a child of a display:none panel still computes to block
    // and was being audited while invisible. Anything with no boxes is out.
    if (el.getClientRects().length === 0) return true;
    return s.display === 'none' || s.visibility === 'hidden' || el.closest('[aria-hidden="true"]');
  };
  const name = (el) => {
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const t = labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al?.trim()) return al.trim();
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent?.trim()) return lbl.textContent.trim();
    }
    const wrap = el.closest('label');
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    const title = el.getAttribute('title');
    if (title?.trim()) return title.trim();
    return (el.textContent ?? '').trim();
  };

  // 1. Every interactive control has an accessible name
  document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]').forEach((el) => {
    if (isHidden(el)) return;
    if (!name(el)) problems.push(`no accessible name: <${el.tagName.toLowerCase()} class="${el.className}">`);
  });

  // 2. Every form control has a programmatic label
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (isHidden(el)) return;
    if (el.type === 'hidden') return;
    const labelled =
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
      el.closest('label');
    if (!labelled) problems.push(`unlabelled control: ${el.outerHTML.slice(0, 90)}`);
  });

  // 3. No duplicate ids
  const ids = new Map();
  document.querySelectorAll('[id]').forEach((el) => ids.set(el.id, (ids.get(el.id) ?? 0) + 1));
  [...ids].filter(([, n]) => n > 1).forEach(([id, n]) => problems.push(`duplicate id "${id}" x${n}`));

  // 4. Nothing focusable inside aria-hidden (axe: aria-hidden-focus)
  document.querySelectorAll('[aria-hidden="true"]').forEach((host) => {
    const focusable = host.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length) problems.push(`focusable inside aria-hidden: ${host.tagName.toLowerCase()} (${focusable.length})`);
  });

  // 5. Heading order never skips a level
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => !isHidden(h));
  let prev = 0;
  heads.forEach((h) => {
    const lvl = Number(h.tagName[1]);
    if (prev && lvl > prev + 1) problems.push(`heading jumps h${prev}→h${lvl}: "${h.textContent.trim().slice(0, 40)}"`);
    prev = lvl;
  });
  if (document.querySelectorAll('h1').length !== 1) problems.push(`expected exactly one h1, found ${document.querySelectorAll('h1').length}`);

  // 6. Text contrast against the nearest painted background
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /* Colours are normalised through a canvas rather than parsed by regex.
     A token authored in oklch computes to an oklch string, and reading three
     numbers out of "oklch(0.21 0.014 70)" as if they were channels produced
     a flat 1.00:1 for every pair, which reads as a catastrophic failure when
     nothing is actually wrong. Painting the colour and reading the pixel back
     gives real sRGB bytes for any syntax the browser accepts. */
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  const parse = (s) => {
    if (!s || s === 'transparent' || s === 'none') return [];
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = '#000';
    probeCtx.fillStyle = s;
    // An unparseable value leaves fillStyle at the previous colour, which would
    // silently report black. Compare against a second probe to catch that.
    probeCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  /* Composite translucent layers over their ancestors — a 16% wash over a dark
     card is a dark background, not a saturated one. */
  const bgOf = (el) => {
    const layers = [];
    let node = el;
    while (node && node !== document.documentElement) {
      const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor);
      if (a > 0 && r !== undefined) {
        layers.push([r, g, b, a]);
        if (a === 1) break;
      }
      node = node.parentElement;
    }
    const [rr, gg, bb, aa = 1] = parse(getComputedStyle(document.documentElement).backgroundColor);
    let base = aa === 1 && rr !== undefined ? [rr, gg, bb] : [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) {
      const [r, g, b, a] = layers[i];
      base = [0, 1, 2].map((c) => [r, g, b][c] * a + base[c] * (1 - a));
    }
    return base;
  };
  document.querySelectorAll('p, span, h1, h2, h3, h4, label, button, a, td, th, li, legend, summary, figcaption').forEach((el) => {
    if (isHidden(el) || el.classList.contains('visually-hidden')) return;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!text) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = bgOf(el);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const min = large ? 3 : 4.5;
    if (ratio < min) problems.push(`contrast ${ratio.toFixed(2)}:1 (need ${min}) — "${text.slice(0, 42)}"`);
  });

  // 7. Target size (WCAG 2.2 AA, 24px minimum)
  document.querySelectorAll('button, a[href], input[type="checkbox"], input[type="radio"]').forEach((el) => {
    if (isHidden(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.width < 24 || r.height < 24) problems.push(`target ${Math.round(r.width)}x${Math.round(r.height)} < 24px — "${(el.textContent ?? '').trim().slice(0, 30)}"`);
  });

  return problems;
};

