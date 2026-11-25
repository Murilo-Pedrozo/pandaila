'use strict';

/* ==========================================================================
   VENDAS E LUCRO
   Usa as receitas salvas na aba de Precificação.

   Tipos de lançamento:
     Venda     -> quantidade × preço − desconto = faturamento
                  custo = quantidade × custo por unidade da receita (no dia do lançamento)
     Perda     -> doce que não foi vendido: entra como prejuízo pelo custo
     Produção  -> só controla o estoque (feitos − vendidos − perdidos)
     Despesa   -> gastos fora das receitas (entrega, taxa de app, anúncio)

   Lucro do período = Faturamento − custo dos vendidos − custo das perdas − despesas
   Margem           = Lucro ÷ Faturamento
   ========================================================================== */

const MOV_KINDS = {
  venda: { label: 'Venda', cls: 'k-venda' },
  perda: { label: 'Perda', cls: 'k-perda' },
  producao: { label: 'Produção', cls: 'k-prod' },
  despesa: { label: 'Despesa', cls: 'k-desp' }
};

const LOSS_REASONS = ['Derreteu / estragou', 'Caiu / quebrou', 'Passou da validade', 'Degustação / brinde', 'Consumo próprio', 'Outro'];
const PAYMENTS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Fiado', 'Outro'];

const MOV_HELP = {
  venda: 'O custo é calculado pela receita salva (ingredientes + custos adicionais) no dia do lançamento.',
  perda: 'Doce que não foi vendido: derreteu, caiu, venceu ou foi dado. Entra como prejuízo pelo custo dele.',
  producao: 'Opcional. Serve para controlar o estoque: feitos − vendidos − perdidos.',
  despesa: 'Use para gastos que NÃO estão nas receitas: entrega, taxa de app, anúncio. Não lance ingredientes nem a conta de luz aqui se eles já estão na receita, senão o custo conta duas vezes.'
};

let movKind = 'venda';
let salesPeriod = null;   // 'AAAA-MM' ou 'all'

// ---------------------------------------------------------------- dados
function getMovements() {
  const list = readJSON(KEYS.movements, []);
  return Array.isArray(list) ? list : [];
}

function setMovements(list) {
  return writeJSON(KEYS.movements, list);
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const monthOf = (date) => String(date || '').slice(0, 7);

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return capitalize(new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
}

function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : String(iso);
}

/** Receitas salvas com custo e preço atuais */
function savedRecipeInfo() {
  return getRecipes()
    .map((raw) => {
      const r = normalizeRecipe(raw);
      const c = compute(r);
      return { id: raw.id, name: r.name || 'Sem nome', label: productLabel(r), unitCost: c.unitCost, price: c.price };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// ---------------------------------------------------------------- cálculos
function movGross(m) { return m.kind === 'venda' ? parseNum(m.qty) * parseNum(m.unitPrice) : 0; }
function movNet(m) { return m.kind === 'venda' ? movGross(m) - parseNum(m.discount) : 0; }
function movCost(m) {
  if (m.kind === 'venda' || m.kind === 'perda') return parseNum(m.qty) * parseNum(m.unitCost);
  if (m.kind === 'despesa') return parseNum(m.amount);
  return 0;
}
/** Efeito do lançamento no lucro */
function movProfit(m) {
  if (m.kind === 'venda') return movNet(m) - movCost(m);
  if (m.kind === 'perda' || m.kind === 'despesa') return -movCost(m);
  return 0;
}

function summarize(list) {
  const s = {
    gross: 0, discount: 0, net: 0, salesCount: 0,
    sold: 0, lost: 0, produced: 0,
    costSold: 0, costLost: 0, expenses: 0
  };
  list.forEach((m) => {
    const q = parseNum(m.qty);
    if (m.kind === 'venda') {
      s.gross += movGross(m);
      s.discount += parseNum(m.discount);
      s.net += movNet(m);
      s.sold += q;
      s.costSold += movCost(m);
      s.salesCount++;
    } else if (m.kind === 'perda') {
      s.lost += q;
      s.costLost += movCost(m);
    } else if (m.kind === 'producao') {
      s.produced += q;
    } else if (m.kind === 'despesa') {
      s.expenses += movCost(m);
    }
  });
  s.profit = s.net - s.costSold - s.costLost - s.expenses;
  s.margin = s.net > 0 ? (s.profit / s.net) * 100 : 0;
  s.lossRate = s.sold + s.lost > 0 ? (s.lost / (s.sold + s.lost)) * 100 : 0;
  s.avgTicket = s.salesCount > 0 ? s.net / s.salesCount : 0;
  return s;
}

function inPeriod(m) {
  return salesPeriod === 'all' || monthOf(m.date) === salesPeriod;
}

// ---------------------------------------------------------------- formulário
function fillSelect(el, items, selected) {
  el.innerHTML = items.map((it) => {
    const v = typeof it === 'string' ? it : it.value;
    const t = typeof it === 'string' ? it : it.text;
    return `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(t)}</option>`;
  }).join('');
}

function renderRecipeSelect() {
  const sel = $('movRecipe');
  const current = sel.value;
  const recipes = savedRecipeInfo();
  if (!recipes.length) {
    sel.innerHTML = '<option value="">Salve uma receita primeiro</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  fillSelect(sel, recipes.map((r) => ({ value: r.id, text: r.name })),
    recipes.some((r) => r.id === current) ? current : recipes[0].id);
}

function selectedRecipe() {
  const id = $('movRecipe').value;
  return savedRecipeInfo().find((r) => r.id === id) || null;
}

function applyKind() {
  document.querySelectorAll('.mov-form [data-kinds]').forEach((el) => {
    el.hidden = !el.dataset.kinds.split(' ').includes(movKind);
  });
  setText('movHelp', MOV_HELP[movKind]);
  const btnText = { venda: 'Lançar venda', perda: 'Lançar perda', producao: 'Lançar produção', despesa: 'Lançar despesa' };
  setText('btnAddMov', btnText[movKind]);
  updatePreview();
}

/** Monta o lançamento a partir do formulário (sem salvar) */
function readForm() {
  const r = selectedRecipe();
  const qtyVal = Math.max(0, parseNum($('movQty').value));
  const price = Math.max(0, parseNum($('movPrice').value));
  const discInput = Math.max(0, parseNum($('movDiscount').value));
  const gross = qtyVal * price;
  const discount = $('movDiscountMode').value === 'pct'
    ? gross * Math.min(discInput, 100) / 100
    : Math.min(discInput, gross);

  return {
    kind: movKind,
    date: $('movDate').value || todayISO(),
    recipeId: r ? r.id : null,
    recipeName: r ? r.name : '',
    label: r ? r.label : '',
    qty: movKind === 'despesa' ? 0 : qtyVal,
    unitPrice: movKind === 'venda' ? price : 0,
    discount: movKind === 'venda' ? Math.round(discount * 100) / 100 : 0,
    unitCost: r && (movKind === 'venda' || movKind === 'perda') ? r.unitCost : 0,
    payment: movKind === 'venda' ? $('movPayment').value : '',
    reason: movKind === 'perda' ? $('movReason').value : '',
    desc: movKind === 'despesa' ? $('movDesc').value.trim() : '',
    amount: movKind === 'despesa' ? Math.max(0, parseNum($('movAmount').value)) : 0,
    note: $('movNote').value.trim()
  };
}

function updatePreview() {
  const el = $('movPreview');
  const m = readForm();
  el.classList.remove('warn');

  if (movKind === 'despesa') {
    el.textContent = m.amount > 0 ? `Saída de ${brl(m.amount)}` : '';
    return;
  }
  if (!m.recipeId) {
    el.textContent = 'Primeiro salve uma receita na aba Precificação.';
    el.classList.add('warn');
    return;
  }
  if (movKind === 'producao') {
    let txt = m.qty > 0 ? `+${qty(m.qty)} ${m.label} feitos` : `Custo atual: ${brl(selectedRecipe().unitCost)} por ${m.label}`;
    if (m.qty > 0 && $('movStockOut') && $('movStockOut').checked && typeof recipeStockNeeds === 'function') {
      const needs = recipeStockNeeds(m.recipeId, m.qty);
      if (needs.length) {
        txt += ` · sai do estoque: ${needs.map((n) => `${n.name} ${fmtStockQty(n.amount, n.unit)}${n.amount > n.have + 0.0005 ? ' (falta no estoque)' : ''}`).join(', ')}`;
        if (needs.some((n) => n.amount > n.have + 0.0005)) el.classList.add('warn');
      } else {
        txt += ' · nenhum ingrediente desta receita está no estoque';
      }
    }
    el.textContent = txt;
    return;
  }
  if (movKind === 'perda') {
    el.textContent = m.qty > 0
      ? `${qty(m.qty)} × ${brl(m.unitCost)} de custo = prejuízo de ${brl(movCost(m))}`
      : `Custo atual: ${brl(m.unitCost)} por ${m.label}`;
    el.classList.toggle('warn', m.qty > 0);
    return;
  }
  // Venda
  if (!(m.qty > 0)) {
    el.textContent = `Custo: ${brl(m.unitCost)} por ${m.label} · preço sugerido: ${brl(selectedRecipe().price)}`;
    return;
  }
  const profit = movProfit(m);
  const parts = [`${qty(m.qty)} × ${brl(m.unitPrice)}`];
  if (m.discount > 0) parts.push(`− ${brl(m.discount)} de desconto`);
  el.textContent = `${parts.join(' ')} = ${brl(movNet(m))} · custo ${brl(movCost(m))} · ${profit >= 0 ? 'lucro' : 'prejuízo'} ${brl(Math.abs(profit))}`;
  el.classList.toggle('warn', profit < 0);
}

function addMovement() {
  const m = readForm();

  if (movKind === 'despesa') {
    if (!(m.amount > 0)) { toast('Informe o valor da despesa.', 'error'); $('movAmount').focus(); return; }
    if (!m.desc) { toast('Escreva uma descrição para a despesa.', 'error'); $('movDesc').focus(); return; }
  } else {
    if (!m.recipeId) { toast('Salve uma receita na aba Precificação primeiro.', 'error'); return; }
    if (!(m.qty > 0)) { toast('Informe a quantidade.', 'error'); $('movQty').focus(); return; }
    if (movKind === 'venda' && !(m.unitPrice > 0)) {
      toast('Informe o preço. Se foi dado de graça, lance como Perda (brinde).', 'error');
      $('movPrice').focus();
      return;
    }
  }

  const entry = { id: newId(), createdAt: new Date().toISOString(), ...m };
  let stockMsg = '';
  let stockShort = [];
  if (movKind === 'producao' && $('movStockOut') && $('movStockOut').checked && typeof stockOutForProduction === 'function') {
    const out = stockOutForProduction(m.recipeId, m.qty);
    entry.stockOut = out.items;               // guardado para devolver ao estoque se a produção for excluída
    stockShort = out.short;
    if (out.items.length) stockMsg = ` Baixa de ${out.items.length} ${out.items.length === 1 ? 'ingrediente' : 'ingredientes'} no estoque.`;
  }
  const list = getMovements();
  list.push(entry);
  if (!setMovements(list)) return;

  // Limpa os campos que mudam a cada lançamento
  ['movQty', 'movDiscount', 'movNote', 'movDesc', 'movAmount'].forEach((id) => { $(id).value = ''; });
  if (monthOf(entry.date) !== salesPeriod && salesPeriod !== 'all') salesPeriod = monthOf(entry.date);
  renderSales();

  const msg = {
    venda: `Venda lançada: ${brl(movNet(entry))}`,
    perda: `Perda lançada: ${qty(entry.qty)} un.`,
    producao: `Produção lançada: ${qty(entry.qty)} un.`,
    despesa: `Despesa lançada: ${brl(entry.amount)}`
  };
  toast(msg[movKind] + stockMsg);
  if (stockShort.length) setTimeout(() => toast(`Estoque insuficiente: ${stockShort.join(', ')}.`, 'error'), 400);
  if (typeof renderStockBadge === 'function') renderStockBadge();
  (movKind === 'despesa' ? $('movDesc') : $('movQty')).focus();
}

function deleteMovement(id) {
  const list = getMovements();
  const m = list.find((x) => x.id === id);
  if (!m) return;
  const what = m.kind === 'despesa' ? m.desc : `${qty(m.qty)} × ${m.recipeName}`;
  if (!confirm(`Excluir este lançamento (${MOV_KINDS[m.kind].label}: ${what})?`)) return;
  setMovements(list.filter((x) => x.id !== id));
  let back = '';
  if (Array.isArray(m.stockOut) && m.stockOut.length && typeof restoreStock === 'function') {
    restoreStock(m.stockOut);
    back = ' Os ingredientes voltaram para o estoque.';
    renderStockBadge();
  }
  renderSales();
  toast('Lançamento excluído.' + back);
}

// ---------------------------------------------------------------- telas
function renderPeriodSelect() {
  const months = new Set(getMovements().map((m) => monthOf(m.date)).filter(Boolean));
  months.add(monthOf(todayISO()));
  const sorted = [...months].sort().reverse();
  if (!salesPeriod) salesPeriod = monthOf(todayISO());
  if (salesPeriod !== 'all' && !months.has(salesPeriod)) salesPeriod = sorted[0];
  fillSelect($('salesPeriod'),
    [...sorted.map((ym) => ({ value: ym, text: monthLabel(ym) })), { value: 'all', text: 'Todo o período' }],
    salesPeriod);
}

function renderKpis(s, periodName) {
  setText('kNet', brl(s.net));
  setText('kNetSub', s.discount > 0
    ? `bruto ${brl(s.gross)} · descontos −${brl(s.discount)}`
    : `${s.salesCount} ${s.salesCount === 1 ? 'venda' : 'vendas'}`);

  const loss = s.profit < -0.004;
  setText('kProfitLabel', loss ? 'Prejuízo' : 'Lucro');
  setText('kProfit', brl(Math.abs(s.profit)));
  setText('kProfitSub', s.net > 0 ? `margem de ${pct(s.margin)}` : 'sem vendas no período');
  $('kProfitCard').classList.toggle('good', !loss && s.profit > 0);
  $('kProfitCard').classList.toggle('bad', loss);

  setText('kSold', `${qty(s.sold)} un.`);
  setText('kSoldSub', s.salesCount ? `ticket médio ${brl(s.avgTicket)}` : '—');
  setText('kLost', `${qty(s.lost)} un.`);
  setText('kLostSub', s.lost > 0 ? `${brl(s.costLost)} perdidos · ${pct(s.lossRate)} do total` : 'nenhuma perda');
  setText('kExp', brl(s.expenses));

  const banner = $('salesStatus');
  banner.className = 'status-banner';
  if (!s.salesCount && !s.lost && !s.expenses) {
    banner.textContent = `Nenhum lançamento em ${periodName}. Use o formulário abaixo para lançar vendas, perdas e produção.`;
  } else if (loss) {
    banner.classList.add('bad');
    banner.textContent = `Atenção: ${periodName} está no PREJUÍZO de ${brl(Math.abs(s.profit))}. `
      + (s.costLost > s.net * 0.15 ? 'As perdas estão altas, tente produzir mais perto do que vende. ' : '')
      + (s.discount > s.gross * 0.15 ? 'Os descontos estão pesando. ' : '')
      + 'Revise os preços na aba Precificação.';
  } else {
    banner.classList.add('good');
    banner.textContent = `${capitalize(periodName)} está no LUCRO: sobraram ${brl(s.profit)} depois de pagar ingredientes, custos, perdas e despesas (margem de ${pct(s.margin)}).`;
  }
}

function renderByRecipe(periodList, allList) {
  const groups = new Map();
  const keyOf = (m) => m.recipeId || m.recipeName;
  periodList.filter((m) => m.kind !== 'despesa').forEach((m) => {
    const k = keyOf(m);
    if (!groups.has(k)) groups.set(k, { name: m.recipeName, items: [] });
    groups.get(k).items.push(m);
  });

  const body = $('byRecipeBody');
  if (!groups.size) {
    body.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhuma venda, perda ou produção no período.</td></tr>';
    return;
  }

  const rows = [...groups.entries()].map(([k, g]) => {
    const s = summarize(g.items);
    const all = summarize(allList.filter((m) => keyOf(m) === k));
    const stock = all.produced > 0 ? all.produced - all.sold - all.lost : null;
    return { name: g.name, s, stock };
  }).sort((a, b) => b.s.net - a.s.net);

  body.innerHTML = rows.map(({ name, s, stock }) => {
    const profit = s.net - s.costSold - s.costLost;
    const margin = s.net > 0 ? (profit / s.net) * 100 : 0;
    return `
      <tr>
        <td class="l"><b>${esc(name)}</b></td>
        <td>${s.produced ? qty(s.produced) : '—'}</td>
        <td>${qty(s.sold)}</td>
        <td>${s.lost ? qty(s.lost) : '—'}</td>
        <td class="${stock !== null && stock < 0 ? 'neg' : ''}">${stock === null ? '—' : qty(stock)}</td>
        <td>${brl(s.net)}</td>
        <td class="${profit < -0.004 ? 'neg' : 'pos'}">${brl(profit)}</td>
        <td>${s.net > 0 ? pct(margin) : '—'}</td>
      </tr>`;
  }).join('');
}

function movDescription(m) {
  if (m.kind === 'despesa') return esc(m.desc);
  const extra = [];
  if (m.kind === 'venda') {
    extra.push(`${brl(m.unitPrice)} cada`);
    if (parseNum(m.discount) > 0) extra.push(`desconto ${brl(m.discount)}`);
    if (m.payment) extra.push(m.payment);
  }
  if (m.kind === 'perda' && m.reason) extra.push(m.reason);
  if (m.note) extra.push(m.note);
  return `<b>${esc(m.recipeName)}</b>${extra.length ? `<small>${esc(extra.join(' · '))}</small>` : ''}`;
}

function renderMovList(periodList) {
  const body = $('movBody');
  if (!periodList.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhum lançamento no período.</td></tr>';
    return;
  }
  const sorted = [...periodList].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));

  body.innerHTML = sorted.map((m) => {
    const k = MOV_KINDS[m.kind] || MOV_KINDS.venda;
    let value = '—';
    if (m.kind === 'venda') value = brl(movNet(m));
    if (m.kind === 'perda' || m.kind === 'despesa') value = `−${brl(movCost(m))}`;
    const p = movProfit(m);
    const profitCell = m.kind === 'producao' ? '—' : brl(p);
    return `
      <tr>
        <td class="l nowrap">${fmtDate(m.date)}</td>
        <td class="l"><span class="kind ${k.cls}">${k.label}</span></td>
        <td class="l item">${movDescription(m)}</td>
        <td>${m.kind === 'despesa' ? '—' : qty(m.qty)}</td>
        <td class="nowrap">${value}</td>
        <td class="nowrap ${m.kind === 'producao' ? '' : p < -0.004 ? 'neg' : 'pos'}">${profitCell}</td>
        <td><button type="button" class="icon-btn" data-del="${esc(m.id)}" title="Excluir" aria-label="Excluir lançamento">${ICONS.trash}</button></td>
      </tr>`;
  }).join('');
}

function renderSales() {
  if (!$('viewSales')) return;
  renderPeriodSelect();
  renderRecipeSelect();

  const all = getMovements();
  const periodList = all.filter(inPeriod);
  const periodName = salesPeriod === 'all' ? 'todo o período' : monthLabel(salesPeriod).toLowerCase();

  renderKpis(summarize(periodList), periodName);
  renderByRecipe(periodList, all);
  renderMovList(periodList);
  updatePreview();
}

// ---------------------------------------------------------------- planilha (CSV para Excel)
function downloadCsv() {
  const list = getMovements().filter(inPeriod)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!list.length) { toast('Não há lançamentos no período.', 'error'); return; }

  const num = (n) => (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Data', 'Tipo', 'Receita / Descrição', 'Quantidade', 'Preço unit.', 'Desconto', 'Valor líquido', 'Custo', 'Lucro', 'Pagamento / Motivo', 'Observação'];
  const rows = list.map((m) => [
    fmtDate(m.date),
    MOV_KINDS[m.kind]?.label || m.kind,
    m.kind === 'despesa' ? m.desc : m.recipeName,
    m.kind === 'despesa' ? '' : qty(m.qty),
    m.kind === 'venda' ? num(parseNum(m.unitPrice)) : '',
    m.kind === 'venda' ? num(parseNum(m.discount)) : '',
    m.kind === 'venda' ? num(movNet(m)) : '',
    num(movCost(m)),
    m.kind === 'producao' ? '' : num(movProfit(m)),
    m.payment || m.reason || '',
    m.note || ''
  ]);
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vendas-${salesPeriod === 'all' ? 'todas' : salesPeriod}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Planilha baixada. Abra no Excel ou Google Planilhas.');
}

// ---------------------------------------------------------------- abas
function showView(view) {
  const v = ['pricing', 'sales', 'stock'].includes(view) ? view : 'pricing';
  $('viewPricing').hidden = v !== 'pricing';
  $('viewSales').hidden = v !== 'sales';
  if ($('viewStock')) $('viewStock').hidden = v !== 'stock';
  $('pricingActions').hidden = v !== 'pricing';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  try { localStorage.setItem('doces_aba', v); } catch (e) { /* ignora */ }
  if (v === 'sales') renderSales();
  if (v === 'stock' && typeof renderStock === 'function') renderStock();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- eventos
document.addEventListener('DOMContentLoaded', () => {
  if (!$('viewSales')) return;

  fillSelect($('movPayment'), PAYMENTS, 'Pix');
  fillSelect($('movReason'), LOSS_REASONS, LOSS_REASONS[0]);
  $('movDate').value = todayISO();

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

  document.querySelectorAll('input[name="movKind"]').forEach((el) => {
    el.addEventListener('change', () => { movKind = el.value; applyKind(); });
  });

  $('movRecipe').addEventListener('change', () => {
    const r = selectedRecipe();
    if (r) $('movPrice').value = moneyToInput(r.price);
    updatePreview();
  });

  if ($('movStockOut')) $('movStockOut').addEventListener('change', updatePreview);
  ['movQty', 'movPrice', 'movDiscount', 'movDiscountMode', 'movAmount', 'movDate'].forEach((id) => {
    $(id).addEventListener('input', updatePreview);
  });

  // Enter em qualquer campo do formulário lança
  document.querySelector('.mov-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); addMovement(); }
  });

  $('btnAddMov').addEventListener('click', addMovement);
  $('salesPeriod').addEventListener('change', (e) => { salesPeriod = e.target.value; renderSales(); });
  $('movBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (btn) deleteMovement(btn.dataset.del);
  });
  $('btnCsv').addEventListener('click', downloadCsv);

  // Backup também nesta aba (usa o mesmo arquivo da aba Precificação)
  $('btnExportSales').addEventListener('click', exportBackup);
  $('btnImportSales').addEventListener('click', () => $('importFile').click());

  renderRecipeSelect();
  const r = selectedRecipe();
  if (r) $('movPrice').value = moneyToInput(r.price);
  applyKind();

  let lastView = 'pricing';
  try { lastView = localStorage.getItem('doces_aba') || 'pricing'; } catch (e) { /* ignora */ }
  showView(lastView);
});
