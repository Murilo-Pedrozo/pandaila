'use strict';

/* ==========================================================================
   ESTOQUE DE INGREDIENTES
   Cada compra vira um "lote": produto, quantidade, preço pago, data da compra
   e validade. O estoque de um produto é a soma do que sobrou dos lotes.

   Baixa (uso): sempre gasta primeiro o lote que vence antes (e, empatando,
   o comprado antes). Pode ser manual ou automática ao lançar uma Produção na
   aba Vendas (tira os ingredientes da receita proporcionalmente).

   As quantidades ficam guardadas na unidade base: g, ml ou un
   (1 kg = 1000 g, 1 L = 1000 ml).
   ========================================================================== */

const STOCK_KEY = 'doces_estoque_v1';
const SOON_DAYS = 7;

let stockFilter = 'all';
const openProducts = new Set();

// ---------------------------------------------------------------- dados
function getStock() {
  const list = readJSON(STOCK_KEY, []);
  return Array.isArray(list) ? list.filter((l) => l && l.id) : [];
}

function setStock(list) {
  return writeJSON(STOCK_KEY, list);
}

const stockKey = (name, unit) => `${String(name || '').trim().toLowerCase()}|${unit}`;

/** Dias até a validade (negativo = vencido); null quando não tem validade */
function daysUntil(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

function expiryInfo(iso) {
  const d = daysUntil(iso);
  if (d === null) return { cls: 'none', text: 'sem validade', days: null };
  const when = fmtDate(iso);
  if (d < 0) return { cls: 'bad', text: `venceu em ${when}`, days: d };
  if (d === 0) return { cls: 'bad', text: 'vence hoje', days: d };
  if (d <= SOON_DAYS) return { cls: 'soon', text: `vence em ${d} ${d === 1 ? 'dia' : 'dias'} (${when})`, days: d };
  return { cls: 'ok', text: `vence ${when}`, days: d };
}

/** Mostra a quantidade de um jeito fácil de ler: 1.500 g -> 1,5 kg */
function fmtStockQty(n, unit) {
  if (unit === 'g' && Math.abs(n) >= 1000) return `${qty(n / 1000)} kg`;
  if (unit === 'ml' && Math.abs(n) >= 1000) return `${qty(n / 1000)} L`;
  return `${qty(n)} ${unit}`;
}

/** Agrupa os lotes por produto */
function stockProducts(list = getStock()) {
  const map = new Map();
  list.forEach((l) => {
    const k = stockKey(l.name, l.unit);
    if (!map.has(k)) map.set(k, { key: k, name: l.name, unit: l.unit, lots: [], left: 0, value: 0 });
    const p = map.get(k);
    p.lots.push(l);
    const left = Math.max(0, parseNum(l.qtyLeft));
    p.left += left;
    const unitPrice = parseNum(l.qtyInitial) > 0 ? parseNum(l.price) / parseNum(l.qtyInitial) : 0;
    p.value += left * unitPrice;
  });
  map.forEach((p) => {
    p.lots.sort(lotOrder);
    const active = p.lots.filter((l) => parseNum(l.qtyLeft) > 0);
    p.activeLots = active;
    const withExp = active.filter((l) => daysUntil(l.expiry) !== null);
    p.next = withExp.length ? withExp.reduce((a, b) => (a.expiry <= b.expiry ? a : b)) : null;
    p.expiredQty = active.filter((l) => { const d = daysUntil(l.expiry); return d !== null && d < 0; })
      .reduce((s, l) => s + parseNum(l.qtyLeft), 0);
    const d = p.next ? daysUntil(p.next.expiry) : null;
    p.status = !active.length ? 'empty' : d !== null && d <= 0 ? 'expired' : d !== null && d <= SOON_DAYS ? 'soon' : 'ok';
  });
  return [...map.values()];
}

/** Ordem de uso: vence antes primeiro; sem validade por último; empate = comprado antes */
function lotOrder(a, b) {
  const ea = a.expiry || '9999-12-31';
  const eb = b.expiry || '9999-12-31';
  return ea.localeCompare(eb) || String(a.buyDate).localeCompare(String(b.buyDate)) || String(a.createdAt).localeCompare(String(b.createdAt));
}

/**
 * Tira uma quantidade do estoque de um produto (na unidade base).
 * Retorna quanto conseguiu tirar, quanto faltou e de quais lotes saiu.
 */
function consumeStock(list, key, amount, skipExpired = false) {
  const lots = list
    .filter((l) => stockKey(l.name, l.unit) === key && parseNum(l.qtyLeft) > 0)
    .filter((l) => { if (!skipExpired) return true; const d = daysUntil(l.expiry); return d === null || d >= 0; })
    .sort(lotOrder);
  let rest = amount;
  const taken = [];
  for (const l of lots) {
    if (rest <= 1e-9) break;
    const t = Math.min(parseNum(l.qtyLeft), rest);
    l.qtyLeft = Math.round((parseNum(l.qtyLeft) - t) * 1000) / 1000;
    rest -= t;
    taken.push({ id: l.id, qty: Math.round(t * 1000) / 1000 });
  }
  return { used: amount - Math.max(0, rest), missing: Math.max(0, rest), taken };
}

/** Devolve ao estoque o que uma baixa tirou (ao excluir uma produção) */
function restoreStock(takenByItem) {
  if (!Array.isArray(takenByItem) || !takenByItem.length) return 0;
  const list = getStock();
  let n = 0;
  takenByItem.forEach((item) => (item.taken || []).forEach((t) => {
    const lot = list.find((l) => l.id === t.id);
    if (lot) { lot.qtyLeft = Math.round((parseNum(lot.qtyLeft) + parseNum(t.qty)) * 1000) / 1000; n++; }
  }));
  setStock(list);
  return n;
}

/** Ingredientes de uma receita que existem no estoque, para uma produção de `units` unidades */
function recipeStockNeeds(recipeId, units) {
  const raw = getRecipes().find((r) => r.id === recipeId);
  if (!raw) return [];
  const r = normalizeRecipe(raw);
  const factor = units / Math.max(1, r.yield);
  const products = new Map(stockProducts().map((p) => [p.key, p]));
  const needs = [];
  r.ingredients.forEach((it) => {
    if (!it.name.trim() || !(parseNum(it.used) > 0)) return;
    const unit = baseUnit(it.pkgUnit);
    const key = stockKey(it.name, unit);
    if (!products.has(key)) return;               // ingrediente que você não controla no estoque
    const p = products.get(key);
    const haveValid = p.activeLots.filter((l) => { const d = daysUntil(l.expiry); return d === null || d >= 0; })
      .reduce((s, l) => s + parseNum(l.qtyLeft), 0);
    needs.push({ key, name: it.name.trim(), unit, amount: parseNum(it.used) * factor, have: haveValid, haveValid });
  });
  return needs;
}

/** Baixa automática ao lançar uma produção. Retorna o que foi tirado (para poder desfazer). */
function stockOutForProduction(recipeId, units) {
  const needs = recipeStockNeeds(recipeId, units);
  if (!needs.length) return { items: [], short: [] };
  const list = getStock();
  const items = [];
  const short = [];
  needs.forEach((n) => {
    const res = consumeStock(list, n.key, n.amount, true);     // produção nunca usa lote vencido
    items.push({ key: n.key, name: n.name, unit: n.unit, amount: Math.round(n.amount * 1000) / 1000, taken: res.taken });
    if (res.missing > 0.0005) {
      const onlyExpired = n.have > 0 && n.haveValid < n.amount;
      short.push(`${n.name} (faltou ${fmtStockQty(res.missing, n.unit)}${onlyExpired && n.haveValid === 0 ? ', só tem lote vencido' : ''})`);
    }
  });
  setStock(list);
  return { items, short };
}

// ---------------------------------------------------------------- formulário de compra
function readPurchase() {
  const packs = Math.max(0, parseNum($('stPacks').value) || 1);
  const packQty = Math.max(0, parseNum($('stPackQty').value));
  const unitSel = $('stUnit').value;
  const packPrice = Math.max(0, parseNum($('stPackPrice').value));
  const unit = baseUnit(unitSel);
  const total = packs * packQty * unitFactor(unitSel);
  return {
    name: $('stName').value.trim(),
    buyDate: $('stBuyDate').value || todayISO(),
    expiry: $('stExpiry').value || '',
    packs, packQty, unitSel, packPrice, unit,
    qty: Math.round(total * 1000) / 1000,
    price: Math.round(packs * packPrice * 100) / 100,
    note: $('stNote').value.trim()
  };
}

function updatePurchasePreview() {
  const p = readPurchase();
  const el = $('stPreview');
  el.classList.remove('warn');
  if (!(p.packQty > 0)) { el.textContent = ''; return; }
  const parts = [`${qty(p.packs)} × ${qty(p.packQty)} ${p.unitSel} = ${fmtStockQty(p.qty, p.unit)}`];
  if (p.packPrice > 0) parts.push(`total ${brl(p.price)} (${brl(p.price / p.qty, 4)} por ${p.unit})`);
  if (p.expiry) {
    const e = expiryInfo(p.expiry);
    parts.push(e.text);
    if (e.cls === 'bad' || e.cls === 'soon') el.classList.add('warn');
  }
  el.textContent = parts.join(' · ');
}

/** Quando escolhe um produto já conhecido, preenche tamanho, unidade e preço da última compra */
function fillPurchaseFromKnown() {
  const name = $('stName').value.trim().toLowerCase();
  if (!name) return;
  const lib = getLibrary()[name];
  if (lib) {
    if (!$('stPackQty').value) $('stPackQty').value = numToInput(lib.pkgQty);
    if (UNIT_OPTIONS.includes(lib.pkgUnit)) $('stUnit').value = lib.pkgUnit;
    if (!$('stPackPrice').value) $('stPackPrice').value = moneyToInput(lib.price);
  }
  updatePurchasePreview();
}

function addPurchase() {
  const p = readPurchase();
  if (!p.name) { toast('Escreva o nome do produto.', 'error'); $('stName').focus(); return; }
  if (!(p.packQty > 0)) { toast('Informe o tamanho da embalagem (ex.: 395 g).', 'error'); $('stPackQty').focus(); return; }
  if (p.expiry && p.expiry < p.buyDate) { toast('A validade está antes da data da compra. Confira as datas.', 'error'); $('stExpiry').focus(); return; }

  const list = getStock();
  // Se já existe o produto com outra unidade (ex.: g e ml), avisa para não misturar
  const other = stockProducts(list).find((x) => x.name.trim().toLowerCase() === p.name.toLowerCase() && x.unit !== p.unit && x.left > 0);
  if (other && !confirm(`"${p.name}" já está no estoque em ${other.unit}. Registrar esta compra em ${p.unit} vai criar um item separado. Continuar?`)) return;

  list.push({
    id: newId(), name: p.name, unit: p.unit,
    qtyInitial: p.qty, qtyLeft: p.qty, price: p.price,
    packs: p.packs, packQty: p.packQty, packUnit: p.unitSel,
    buyDate: p.buyDate, expiry: p.expiry, note: p.note,
    createdAt: new Date().toISOString()
  });
  if (!setStock(list)) return;

  // Atualiza o preço no cadastro de ingredientes (usado nas receitas)
  if (p.packPrice > 0) saveToLibrary([{ name: p.name, price: p.packPrice, pkgQty: p.packQty, pkgUnit: p.unitSel }]);

  ['stPacks', 'stPackQty', 'stPackPrice', 'stExpiry', 'stNote', 'stName'].forEach((id) => { $(id).value = ''; });
  $('stPreview').textContent = '';
  openProducts.add(stockKey(p.name, p.unit));
  renderStock();
  toast(`Compra registrada: ${p.name} +${fmtStockQty(p.qty, p.unit)}.`);
  $('stName').focus();
}

// ---------------------------------------------------------------- tela
function renderStockBadge() {
  const prods = stockProducts();
  const n = prods.filter((p) => p.status === 'expired' || p.status === 'soon').length;
  const b = $('stockBadge');
  if (!b) return;
  b.textContent = String(n);
  b.hidden = !n;
}

function renderStock() {
  renderStockBadge();
  if (!$('viewStock') || $('viewStock').hidden) return;

  const all = stockProducts();
  const active = all.filter((p) => p.left > 0);
  const lotsActive = active.flatMap((p) => p.activeLots);
  const soonLots = lotsActive.filter((l) => { const d = daysUntil(l.expiry); return d !== null && d >= 0 && d <= SOON_DAYS; });
  const expLots = lotsActive.filter((l) => { const d = daysUntil(l.expiry); return d !== null && d < 0; });
  const value = active.reduce((s, p) => s + p.value, 0);
  const expValue = expLots.reduce((s, l) => s + parseNum(l.qtyLeft) * (parseNum(l.qtyInitial) ? parseNum(l.price) / parseNum(l.qtyInitial) : 0), 0);

  setText('stProducts', String(active.length));
  setText('stProductsSub', all.length - active.length ? `${all.length - active.length} acabaram` : `${lotsActive.length} ${lotsActive.length === 1 ? 'lote' : 'lotes'}`);
  setText('stValue', brl(value));
  setText('stSoon', String(soonLots.length));
  setText('stSoonSub', soonLots.length ? [...new Set(soonLots.map((l) => l.name))].slice(0, 3).join(', ') : 'nada vencendo');
  setText('stExpired', String(expLots.length));
  setText('stExpiredSub', expLots.length ? `${brl(expValue)} perdidos` : 'nenhum vencido');
  $('stSoonCard').className = 'kpi' + (soonLots.length ? ' warn' : '');
  $('stExpiredCard').className = 'kpi' + (expLots.length ? ' bad' : '');

  const banner = $('stockStatus');
  banner.className = 'status-banner';
  if (!all.length) {
    banner.textContent = 'Nenhuma compra registrada ainda. Use o formulário para cadastrar o que você tem em casa, com a validade de cada um.';
  } else if (expLots.length) {
    banner.classList.add('bad');
    banner.textContent = `Atenção: ${[...new Set(expLots.map((l) => l.name))].join(', ')} ${expLots.length === 1 ? 'está vencido' : 'têm lotes vencidos'}. Confira e dê baixa (ou exclua o lote) para não usar por engano.`;
  } else if (soonLots.length) {
    banner.classList.add('warn');
    banner.textContent = `Use logo: ${soonLots.map((l) => `${l.name} (${expiryInfo(l.expiry).text})`).join(', ')}.`;
  } else {
    banner.classList.add('good');
    banner.textContent = `Tudo dentro da validade. Você tem ${brl(value)} em ingredientes no estoque.`;
  }

  document.querySelectorAll('#stFilter .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === stockFilter));
  const q = $('stSearch').value.trim().toLowerCase();
  const rank = { expired: 0, soon: 1, ok: 2, empty: 3 };
  const shown = all
    .filter((p) => stockFilter === 'all' ? p.status !== 'empty' || q : p.status === stockFilter)
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, 'pt-BR'));

  const box = $('stockList');
  if (!shown.length) {
    const msg = { all: 'Nenhum produto no estoque.', soon: 'Nada vencendo nos próximos 7 dias.', expired: 'Nenhum lote vencido.', empty: 'Nenhum produto acabou.' };
    box.innerHTML = `<div class="empty">${esc(q ? 'Nenhum produto encontrado.' : msg[stockFilter])}</div>`;
    return;
  }

  box.innerHTML = shown.map((p) => {
    const e = p.next ? expiryInfo(p.next.expiry) : null;
    const pill = p.status === 'empty'
      ? '<span class="exp none">acabou</span>'
      : e ? `<span class="exp ${e.cls}">${esc(e.text)}</span>` : '<span class="exp none">sem validade</span>';
    const open = openProducts.has(p.key);
    const lots = p.lots.map((l) => {
      const le = expiryInfo(l.expiry);
      const empty = !(parseNum(l.qtyLeft) > 0);
      return `<tr class="${empty ? 'lot-empty' : ''}">
        <td class="l nowrap">${esc(fmtDate(l.buyDate))}</td>
        <td class="l"><span class="exp ${empty ? 'none' : le.cls}">${esc(l.expiry ? fmtDate(l.expiry) : 'sem validade')}</span></td>
        <td class="nowrap">${esc(fmtStockQty(parseNum(l.qtyLeft), l.unit))}<small> de ${esc(fmtStockQty(parseNum(l.qtyInitial), l.unit))}</small></td>
        <td class="nowrap">${esc(brl(parseNum(l.price)))}</td>
        <td class="l item">${esc(l.note || '')}</td>
        <td><button type="button" class="icon-btn" data-dellot="${esc(l.id)}" title="Excluir lote" aria-label="Excluir lote">${ICONS.trash}</button></td>
      </tr>`;
    }).join('');
    return `
      <div class="st-prod ${p.status}" data-key="${esc(p.key)}">
        <div class="st-head">
          <div class="st-name">
            <b>${esc(p.name)}</b>
            <small>${p.activeLots.length} ${p.activeLots.length === 1 ? 'lote' : 'lotes'} · ${esc(brl(p.value))} em estoque${p.expiredQty > 0 ? ` · <span class="neg-txt">${esc(fmtStockQty(p.expiredQty, p.unit))} vencido</span>` : ''}</small>
          </div>
          <div class="st-qty"><strong>${esc(fmtStockQty(p.left, p.unit))}</strong>${pill}</div>
        </div>
        <div class="st-actions">
          <div class="qty st-use">
            <input class="in num" type="text" inputmode="decimal" placeholder="Qtd. usada" data-useqty="${esc(p.key)}" aria-label="Quantidade usada de ${esc(p.name)}" ${p.left > 0 ? '' : 'disabled'} />
            <span class="unit-tag">${esc(p.unit)}</span>
          </div>
          <button type="button" class="btn btn-soft" data-use="${esc(p.key)}" ${p.left > 0 ? '' : 'disabled'}>Dar baixa</button>
          <button type="button" class="btn btn-soft" data-toggle="${esc(p.key)}" aria-expanded="${open}">${open ? 'Esconder' : 'Ver'} compras (${p.lots.length})</button>
          <button type="button" class="btn btn-soft" data-rebuy="${esc(p.key)}">Comprar de novo</button>
        </div>
        <div class="st-lots" ${open ? '' : 'hidden'}>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th class="l">Comprado</th><th class="l">Validade</th><th>Restante</th><th>Pago</th><th class="l">Onde</th><th></th></tr></thead>
              <tbody>${lots}</tbody>
            </table>
          </div>
          ${p.lots.some((l) => !(parseNum(l.qtyLeft) > 0)) ? `<button type="button" class="btn btn-soft st-clean" data-clean="${esc(p.key)}">Apagar compras já usadas</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function useStockManual(key) {
  const input = document.querySelector(`[data-useqty="${CSS.escape(key)}"]`);
  const amount = parseNum(input && input.value);
  if (!(amount > 0)) { toast('Digite a quantidade usada.', 'error'); if (input) input.focus(); return; }
  const list = getStock();
  const res = consumeStock(list, key, amount);
  setStock(list);
  const unit = key.split('|')[1];
  const name = (list.find((l) => stockKey(l.name, l.unit) === key) || {}).name || '';
  renderStock();
  toast(res.missing > 0.0005
    ? `Baixa de ${fmtStockQty(res.used, unit)} em ${name}. Faltaram ${fmtStockQty(res.missing, unit)} no estoque.`
    : `Baixa de ${fmtStockQty(res.used, unit)} em ${name}.`, res.missing > 0.0005 ? 'error' : 'success');
}

function onStockClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.use) { useStockManual(t.dataset.use); return; }
  if (t.dataset.toggle) {
    const k = t.dataset.toggle;
    if (openProducts.has(k)) openProducts.delete(k); else openProducts.add(k);
    renderStock();
    return;
  }
  if (t.dataset.rebuy) {
    const p = stockProducts().find((x) => x.key === t.dataset.rebuy);
    if (!p) return;
    const last = p.lots.slice().sort((a, b) => String(b.buyDate).localeCompare(String(a.buyDate)))[0];
    $('stName').value = p.name;
    if (last) {
      $('stPackQty').value = numToInput(parseNum(last.packQty) || parseNum(last.qtyInitial));
      $('stUnit').value = last.packUnit || last.unit;
      $('stPackPrice').value = last.packs ? moneyToInput(parseNum(last.price) / parseNum(last.packs)) : moneyToInput(parseNum(last.price));
    }
    $('stPacks').value = '1';
    $('stBuyDate').value = todayISO();
    $('stExpiry').value = '';
    updatePurchasePreview();
    $('stExpiry').focus();
    $('stName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Confira a validade da nova compra e registre.');
    return;
  }
  if (t.dataset.dellot) {
    const list = getStock();
    const lot = list.find((l) => l.id === t.dataset.dellot);
    if (!lot) return;
    if (!confirm(`Excluir a compra de ${lot.name} feita em ${fmtDate(lot.buyDate)}? Isso tira ${fmtStockQty(parseNum(lot.qtyLeft), lot.unit)} do estoque.`)) return;
    setStock(list.filter((l) => l.id !== lot.id));
    renderStock();
    toast('Compra excluída do estoque.');
    return;
  }
  if (t.dataset.clean) {
    const k = t.dataset.clean;
    setStock(getStock().filter((l) => !(stockKey(l.name, l.unit) === k && !(parseNum(l.qtyLeft) > 0))));
    renderStock();
    toast('Compras já usadas apagadas.');
  }
}

// ---------------------------------------------------------------- eventos
document.addEventListener('DOMContentLoaded', () => {
  if (!$('viewStock')) return;
  $('stBuyDate').value = todayISO();
  $('stAdd').addEventListener('click', addPurchase);
  ['stPacks', 'stPackQty', 'stPackPrice', 'stExpiry', 'stUnit'].forEach((id) => $(id).addEventListener('input', updatePurchasePreview));
  $('stName').addEventListener('change', fillPurchaseFromKnown);
  document.querySelector('#viewStock .mov-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); addPurchase(); }
  });
  $('stockList').addEventListener('click', onStockClick);
  $('stockList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.useqty) { e.preventDefault(); useStockManual(e.target.dataset.useqty); }
  });
  $('stSearch').addEventListener('input', renderStock);
  $('stFilter').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) { stockFilter = c.dataset.f; renderStock(); }
  });
  renderStockBadge();
});
