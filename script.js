'use strict';

/* ==========================================================================
   PRECIFICAÇÃO DE DOCES (geladinho, brigadeiro, cone, trufa...)

   Ingredientes:
     Preço por unidade = Valor do produto ÷ Quantidade da embalagem (em g/ml/un)
     Custo na receita  = Preço por unidade × Quantidade usada

   Custos adicionais:
     Contas do mês  -> (luz + água + gás + internet + outros) ÷ doces feitos no mês
                       = custo fixo por doce × rendimento da receita
     Porcentagem    -> % sobre o valor dos ingredientes
     Mão de obra    -> minutos na receita ÷ 60 × valor da hora

   Custo por unidade = Custo total ÷ Rendimento
   Preço de venda    = Custo por unidade + % escolhida

   Tudo fica salvo no navegador (localStorage) e pode ser exportado em backup.
   ========================================================================== */

// As chaves continuam as mesmas para não perder o que já foi salvo
const KEYS = {
  recipes: 'geladinho_receitas_v2',
  draft: 'geladinho_rascunho_v2',
  library: 'geladinho_insumos_v2',
  settings: 'geladinho_config_v2',
  movements: 'doces_movimentos_v1',
  legacy: 'geladinho_gourmet_recipes_v1'
};

const UNIT_OPTIONS = ['g', 'kg', 'ml', 'L', 'un'];
const MONTHLY_KEYS = ['luz', 'agua', 'gas', 'internet', 'outros'];

const EXAMPLES = {
  geladinho: {
    name: 'Geladinho de Manga', type: 'Geladinho',
    yield: 12, size: 120, sizeUnit: 'ml',
    overheadMode: 'monthly', overhead: 10, laborMinutes: 40, extra: 0,
    markup: 100,
    ingredients: [
      { name: 'Leite', price: 5.00, pkgQty: 1, pkgUnit: 'L', used: 500 },
      { name: 'Leite condensado', price: 7.00, pkgQty: 395, pkgUnit: 'g', used: 198 },
      { name: 'Creme de leite', price: 3.50, pkgQty: 200, pkgUnit: 'g', used: 100 },
      { name: 'Liga neutra', price: 5.70, pkgQty: 100, pkgUnit: 'g', used: 7 },
      { name: 'Manga', price: 6.00, pkgQty: 1, pkgUnit: 'kg', used: 450 },
      { name: 'Açúcar', price: 5.00, pkgQty: 1, pkgUnit: 'kg', used: 50 },
      { name: 'Saquinho', price: 3.90, pkgQty: 100, pkgUnit: 'un', used: 12 }
    ]
  },
  brigadeiro: {
    name: 'Brigadeiro Tradicional', type: 'Brigadeiro',
    yield: 25, size: 20, sizeUnit: 'g',
    overheadMode: 'monthly', overhead: 10, laborMinutes: 60, extra: 0,
    markup: 150,
    ingredients: [
      { name: 'Leite condensado', price: 7.00, pkgQty: 395, pkgUnit: 'g', used: 395 },
      { name: 'Manteiga', price: 12.00, pkgQty: 200, pkgUnit: 'g', used: 20 },
      { name: 'Chocolate em pó 50%', price: 15.00, pkgQty: 200, pkgUnit: 'g', used: 40 },
      { name: 'Creme de leite', price: 3.50, pkgQty: 200, pkgUnit: 'g', used: 50 },
      { name: 'Granulado', price: 14.00, pkgQty: 500, pkgUnit: 'g', used: 80 },
      { name: 'Forminha nº 4', price: 6.00, pkgQty: 100, pkgUnit: 'un', used: 25 }
    ]
  }
};

const DEFAULT_SETTINGS = {
  monthly: { luz: 0, agua: 0, gas: 0, internet: 0, outros: 0 },
  monthlyUnits: 0,
  hourRate: 0
};

const ICONS = {
  trash: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  close: '<svg fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18 18 6M6 6l12 12"/></svg>',
  copy: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>'
};

// ---------------------------------------------------------------- estado
let recipe = null;     // receita aberta na tela
let settings = null;   // contas do mês e valor da hora (valem para todas as receitas)
let dirty = false;     // há alterações não salvas na receita?
let draftTimer = null;
let settingsTimer = null;

// ---------------------------------------------------------------- utilidades
const $ = (id) => document.getElementById(id);

/** Aceita "5,70", "5.70", "1.000,50", "R$ 3,90" */
function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/R\$|\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function numToInput(n) {
  if (!n) return '';
  return String(Math.round(n * 10000) / 10000).replace('.', ',');
}

function moneyToInput(n) {
  return (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',');
}

function brl(n, decimals = 2) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
}

function qty(n) {
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function pct(n) {
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const newId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    toast('Não foi possível salvar neste navegador. Use "Baixar backup".', 'error');
    return false;
  }
}

function toast(message, type = 'success') {
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 260);
  }, 2800);
}

// ---------------------------------------------------------------- nome do produto
/**
 * Descobre como chamar cada unidade: "brigadeiro", "cone trufado", "geladinho".
 * Usa o campo "Tipo de doce"; se estiver vazio, pega o começo do nome da receita
 * ("Cone trufado de Ninho" -> "cone trufado").
 */
const KNOWN_TYPES = ['bolo de pote', 'pão de mel', 'fatia de bolo', 'copo da felicidade', 'ovo de colher', 'cone trufado'];

function typeFromName(name) {
  const lower = String(name || '').trim().toLowerCase();
  const known = KNOWN_TYPES.find((t) => lower === t || lower.startsWith(t + ' '));
  if (known) return known;
  const first = String(name || '').trim()
    .split(/\s+(?:de|da|do|das|dos|com|c\/|sabor|recheado|recheada)\s+/i)[0]
    .trim();
  return first.length > 0 && first.length <= 28 ? first : '';
}

function productLabel(r) {
  const t = String(r.type || '').trim() || typeFromName(r.name);
  return t ? t.toLowerCase() : 'unidade';
}

// ---------------------------------------------------------------- modelo / cálculos
const baseUnit = (u) => (u === 'kg' ? 'g' : u === 'L' ? 'ml' : (u || 'g'));
const unitFactor = (u) => (u === 'kg' || u === 'L' ? 1000 : 1);

/** Valor do produto ÷ quantidade da embalagem (já convertida para g/ml/un) */
function pricePerUnit(it) {
  const pkg = parseNum(it.pkgQty) * unitFactor(it.pkgUnit);
  return pkg > 0 ? parseNum(it.price) / pkg : 0;
}

/** Preço por unidade × quantidade usada */
function itemCost(it) {
  return pricePerUnit(it) * parseNum(it.used);
}

function blankIngredient() {
  return { name: '', price: 0, pkgQty: 0, pkgUnit: 'g', used: 0 };
}

function blankRecipe() {
  return {
    id: null, name: '', type: '', yield: 10, size: '', sizeUnit: 'g',
    overheadMode: 'monthly', overhead: 10, laborMinutes: 0, extra: 0,
    markup: 100, priceMode: 'markup', manualPrice: 0, roundUp: false,
    ingredients: [blankIngredient()]
  };
}

/** Garante que uma receita (salva, importada ou antiga) tenha todos os campos */
function normalizeRecipe(raw) {
  const r = { ...blankRecipe(), ...(raw || {}) };
  r.name = String(r.name ?? '');
  r.type = String(r.type ?? '');
  r.yield = Math.max(1, Math.round(parseNum(r.yield)) || 1);
  r.size = parseNum(r.size) || '';
  r.sizeUnit = r.sizeUnit === 'ml' ? 'ml' : 'g';
  // Receitas antigas não têm modo: se tinham porcentagem, continuam com porcentagem
  if (!raw || !('overheadMode' in raw)) {
    r.overheadMode = parseNum(raw?.overhead) > 0 ? 'percent' : (raw ? 'none' : 'monthly');
  }
  r.overheadMode = ['monthly', 'percent', 'none'].includes(r.overheadMode) ? r.overheadMode : 'monthly';
  r.overhead = Math.max(0, parseNum(r.overhead));
  r.laborMinutes = Math.max(0, parseNum(r.laborMinutes));
  r.extra = Math.max(0, parseNum(r.extra));
  r.markup = Math.max(0, parseNum(r.markup));
  r.manualPrice = Math.max(0, parseNum(r.manualPrice));
  r.priceMode = r.priceMode === 'manual' ? 'manual' : 'markup';
  r.roundUp = !!r.roundUp;
  const list = Array.isArray(raw?.ingredients) ? raw.ingredients : [];
  r.ingredients = list.length
    ? list.map((i) => ({
      name: String(i?.name ?? ''),
      price: parseNum(i?.price),
      pkgQty: parseNum(i?.pkgQty),
      pkgUnit: UNIT_OPTIONS.includes(i?.pkgUnit) ? i.pkgUnit : 'g',
      used: parseNum(i?.used)
    }))
    : [blankIngredient()];
  return r;
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const m = s.monthly && typeof s.monthly === 'object' ? s.monthly : {};
  const monthly = {};
  MONTHLY_KEYS.forEach((k) => { monthly[k] = Math.max(0, parseNum(m[k])); });
  return {
    monthly,
    monthlyUnits: Math.max(0, Math.round(parseNum(s.monthlyUnits))),
    hourRate: Math.max(0, parseNum(s.hourRate))
  };
}

function compute(r, s = settings || DEFAULT_SETTINGS) {
  const ingTotal = r.ingredients.reduce((sum, it) => sum + itemCost(it), 0);
  // Massa: soma das quantidades em g/ml (itens em "un" ficam de fora)
  const mass = r.ingredients.reduce(
    (sum, it) => (baseUnit(it.pkgUnit) === 'un' ? sum : sum + parseNum(it.used)), 0);
  const units = Math.max(1, Math.round(parseNum(r.yield)) || 1);

  // Água, luz, gás...
  const monthlyTotal = MONTHLY_KEYS.reduce((sum, k) => sum + parseNum(s.monthly?.[k]), 0);
  const monthlyUnits = parseNum(s.monthlyUnits);
  const fixedPerUnit = monthlyUnits > 0 ? monthlyTotal / monthlyUnits : 0;
  let overheadVal = 0;
  if (r.overheadMode === 'monthly') overheadVal = fixedPerUnit * units;
  else if (r.overheadMode === 'percent') overheadVal = ingTotal * parseNum(r.overhead) / 100;

  // Mão de obra e outros
  const labor = (parseNum(r.laborMinutes) / 60) * parseNum(s.hourRate);
  const extra = parseNum(r.extra);

  const totalCost = ingTotal + overheadVal + labor + extra;
  const unitCost = totalCost / units;

  let rawPrice;
  let price;
  if (r.priceMode === 'manual') {
    price = rawPrice = parseNum(r.manualPrice);
  } else {
    rawPrice = unitCost * (1 + parseNum(r.markup) / 100);
    price = r.roundUp ? Math.ceil(rawPrice * 2 - 1e-9) / 2 : rawPrice;
  }

  const effMarkup = unitCost > 0 ? (price / unitCost - 1) * 100 : 0;
  const unitProfit = price - unitCost;

  return {
    ingTotal, mass, units,
    massPerUnit: mass / units,
    monthlyTotal, monthlyUnits, fixedPerUnit,
    overheadVal, labor, extra, totalCost, unitCost,
    rawPrice, price, effMarkup, unitProfit,
    revenue: price * units,
    totalProfit: unitProfit * units,
    marginOnSale: price > 0 ? (unitProfit / price) * 100 : 0
  };
}

// ---------------------------------------------------------------- tabela de ingredientes
function rowHTML(it, i) {
  const options = UNIT_OPTIONS.map(
    (u) => `<option value="${u}"${u === it.pkgUnit ? ' selected' : ''}>${u}</option>`).join('');
  return `
    <tr data-i="${i}">
      <td class="c-name" data-label="Ingrediente">
        <input class="in" data-f="name" list="ingLibrary" value="${esc(it.name)}" placeholder="Ex.: Leite condensado" autocomplete="off" />
      </td>
      <td data-label="Valor do produto">
        <div class="affix"><span>R$</span>
          <input class="in num" data-f="price" inputmode="decimal" value="${esc(numToInput(it.price))}" placeholder="0,00" />
        </div>
      </td>
      <td data-label="Qtd. embalagem">
        <div class="qty">
          <input class="in num" data-f="pkgQty" inputmode="decimal" value="${esc(numToInput(it.pkgQty))}" placeholder="0" />
          <select class="in-select" data-f="pkgUnit" aria-label="Unidade da embalagem">${options}</select>
        </div>
        <small class="conv" data-out="conv"></small>
      </td>
      <td class="calc" data-label="Preço por unidade">
        <span data-out="unit">R$ 0,0000</span>
        <small data-out="per">por g</small>
      </td>
      <td data-label="Qtd. usada">
        <div class="qty">
          <input class="in num" data-f="used" inputmode="decimal" value="${esc(numToInput(it.used))}" placeholder="0" />
          <span class="unit-tag" data-out="base">g</span>
        </div>
      </td>
      <td class="calc cost" data-label="Custo na receita"><span data-out="cost">R$ 0,00</span></td>
      <td class="act no-print">
        <button type="button" class="icon-btn" data-act="remove" title="Remover item" aria-label="Remover item">${ICONS.close}</button>
      </td>
    </tr>`;
}

function renderIngredients() {
  $('ingBody').innerHTML = recipe.ingredients.map(rowHTML).join('');
  recipe.ingredients.forEach((_, i) => updateRow(i));
}

function updateRow(i) {
  const it = recipe.ingredients[i];
  const row = $('ingBody').querySelector(`tr[data-i="${i}"]`);
  if (!it || !row) return;
  const bu = baseUnit(it.pkgUnit);
  row.querySelector('[data-out="unit"]').textContent = brl(pricePerUnit(it), 4);
  row.querySelector('[data-out="per"]').textContent = 'por ' + bu;
  row.querySelector('[data-out="base"]').textContent = bu;
  row.querySelector('[data-out="cost"]').textContent = brl(itemCost(it));
  row.querySelector('[data-out="conv"]').textContent =
    unitFactor(it.pkgUnit) > 1 && parseNum(it.pkgQty) > 0
      ? `= ${qty(parseNum(it.pkgQty) * 1000)} ${bu}` : '';
}

function addIngredient() {
  recipe.ingredients.push(blankIngredient());
  renderIngredients();
  const rows = $('ingBody').querySelectorAll('tr');
  const last = rows[rows.length - 1];
  if (last) {
    last.classList.add('row-new');
    last.querySelector('[data-f="name"]').focus();
  }
  update(true);
}

/** Se o ingrediente já foi usado em outra receita, puxa o preço do cadastro */
function fillFromLibrary(i) {
  const it = recipe.ingredients[i];
  if (!it || parseNum(it.price) > 0) return;
  const match = getLibrary()[it.name.trim().toLowerCase()];
  if (!match) return;
  it.price = match.price;
  it.pkgQty = match.pkgQty;
  it.pkgUnit = match.pkgUnit;
  const row = $('ingBody').querySelector(`tr[data-i="${i}"]`);
  row.querySelector('[data-f="price"]').value = numToInput(match.price);
  row.querySelector('[data-f="pkgQty"]').value = numToInput(match.pkgQty);
  row.querySelector('[data-f="pkgUnit"]').value = match.pkgUnit;
  updateRow(i);
  update(true);
  toast(`Preço de "${match.name}" preenchido pelo seu cadastro.`);
}

// ---------------------------------------------------------------- atualização da tela
function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function update(userChange = false) {
  const c = compute(recipe);
  const label = productLabel(recipe);       // ex.: "brigadeiro"
  const unitsTxt = `${c.units} un.`;

  // Tipo de doce: mostra o automático como dica
  const auto = typeFromName(recipe.name);
  $('productType').placeholder = auto ? `Automático: ${auto.toLowerCase()}` : 'Ex.: Brigadeiro';

  // Ingredientes
  setText('ingTotalFoot', brl(c.ingTotal));

  // Custos adicionais
  $('ohMonthlyPanel').hidden = recipe.overheadMode !== 'monthly';
  $('ohPercentPanel').hidden = recipe.overheadMode !== 'percent';

  const mLine = $('monthlyLine');
  if (c.monthlyTotal > 0 && c.monthlyUnits > 0) {
    mLine.textContent = `${brl(c.monthlyTotal)} ÷ ${qty(c.monthlyUnits)} doces = ${brl(c.fixedPerUnit)} por ${label} → ${brl(c.overheadVal)} nesta receita (${unitsTxt})`;
    mLine.classList.remove('warn');
  } else if (c.monthlyTotal > 0) {
    mLine.textContent = 'Informe quantos doces você faz por mês para dividir as contas.';
    mLine.classList.add('warn');
  } else {
    mLine.textContent = 'Preencha as contas do mês para incluir água, luz e gás no custo.';
    mLine.classList.add('warn');
  }
  setText('percentLine', parseNum(recipe.overhead) > 0
    ? `${pct(recipe.overhead)} de ${brl(c.ingTotal)} = ${brl(c.overheadVal)} nesta receita` : '');

  // Resultado da receita
  setText('resTotalCost', brl(c.totalCost));
  setText('resMass', `${qty(c.mass)} g/ml`);
  setText('lblMassPer', `Massa por ${label}`);
  setText('resMassPer', `${qty(c.massPerUnit)} g/ml`);
  setText('resMassPerHint', `${qty(c.mass)} ÷ ${unitsTxt}`);
  setText('lblUnitCost', `Custo por ${label}`);
  setText('resUnitCost', brl(c.unitCost));
  setText('resUnitCostHint', `${brl(c.totalCost)} ÷ ${unitsTxt}`);

  setText('bkIng', brl(c.ingTotal));
  setText('bkOh', recipe.overheadMode === 'none' ? 'não incluído' : brl(c.overheadVal));
  setText('bkLabor', c.labor > 0 ? `${brl(c.labor)} (${qty(parseNum(recipe.laborMinutes))} min)` : brl(0));
  setText('bkExtra', brl(c.extra));
  setText('bkTotal', brl(c.totalCost));

  // Controles de precificação (não sobrescreve o campo que a pessoa está digitando)
  const active = document.activeElement;
  const shownMarkup = recipe.priceMode === 'manual' ? c.effMarkup : parseNum(recipe.markup);
  if (active !== $('markupInput')) {
    $('markupInput').value = String(Math.round(shownMarkup * 10) / 10).replace('.', ',');
  }
  $('markupSlider').value = Math.min(400, Math.max(0, shownMarkup));
  if (active !== $('priceInput')) $('priceInput').value = moneyToInput(c.price);

  document.querySelectorAll('#chips .chip').forEach((chip) => {
    chip.classList.toggle('active',
      recipe.priceMode === 'markup' && parseNum(recipe.markup) === Number(chip.dataset.m));
  });

  setText('lblMarkup', `Quanto você quer ganhar em cima do custo de cada ${label}?`);
  let line;
  if (recipe.priceMode === 'manual') {
    line = `Preço digitado: ${brl(c.price)} → isso é ${pct(c.effMarkup)} em cima do custo de ${brl(c.unitCost)}.`;
  } else {
    line = `${brl(c.unitCost)} (custo por ${label}) + ${pct(recipe.markup)} = ${brl(c.rawPrice)}`;
    if (recipe.roundUp && Math.abs(c.price - c.rawPrice) > 0.004) line += ` → arredondado para ${brl(c.price)}`;
  }
  setText('formulaLine', line);

  // Resumo lateral
  setText('sumName', recipe.name.trim() || 'Receita sem nome');
  setText('sumSub', `Rende ${c.units} ${c.units === 1 ? 'unidade' : 'unidades'}`
    + (parseNum(recipe.size) ? ` de ${qty(parseNum(recipe.size))} ${recipe.sizeUnit}` : '')
    + (c.mass ? ` · ${qty(c.massPerUnit)} g/ml cada` : ''));
  setText('sumPriceLabel', `Preço de venda por ${label}`);
  setText('sumPrice', brl(c.price));
  setText('sumUnitCostLabel', `Custo por ${label}`);
  setText('sumUnitCost', brl(c.unitCost));
  setText('sumUnitProfitLabel', `Lucro por ${label}`);
  setText('sumUnitProfit', brl(c.unitProfit));
  setText('sumRevenueLabel', `Faturamento (${unitsTxt})`);
  setText('sumRevenue', brl(c.revenue));
  setText('sumTotalCost', brl(c.totalCost));
  setText('sumTotalProfit', brl(c.totalProfit));

  const loss = c.unitProfit < -0.004;
  ['sumUnitProfit', 'sumTotalProfit'].forEach((id) => {
    $(id).classList.toggle('good', !loss);
    $(id).classList.toggle('bad', loss);
  });
  const badge = $('sumBadge');
  badge.classList.toggle('bad', loss);
  badge.textContent = c.unitCost <= 0
    ? 'Preencha os ingredientes'
    : loss ? 'Prejuízo!' : `+${pct(c.effMarkup)} sobre o custo`;

  if (userChange) {
    dirty = true;
    scheduleDraft();
  }
  renderSaveStatus();
}

function fillForm() {
  $('recipeName').value = recipe.name;
  $('productType').value = recipe.type;
  $('recipeYield').value = recipe.yield || '';
  $('unitSize').value = recipe.size ? numToInput(recipe.size) : '';
  $('sizeUnit').value = recipe.sizeUnit;
  document.querySelectorAll('input[name="ohMode"]').forEach((el) => {
    el.checked = el.value === recipe.overheadMode;
  });
  $('overheadPercent').value = numToInput(recipe.overhead);
  $('laborMinutes').value = numToInput(recipe.laborMinutes);
  $('extraCost').value = recipe.extra ? moneyToInput(recipe.extra) : '';
  $('roundUp').checked = recipe.roundUp;
  renderIngredients();
  update(false);
  renderSaved();
}

function renderSaveStatus() {
  const el = $('saveStatus');
  if (dirty) {
    el.textContent = recipe.id ? '● Alterações não salvas' : '● Receita ainda não salva';
    el.className = 'save-status no-print warn';
  } else {
    el.textContent = recipe.id ? '✓ Salva no seu caderno de receitas' : '';
    el.className = 'save-status no-print';
  }
}

// ---------------------------------------------------------------- contas do mês / valor da hora
const SETTINGS_FIELDS = {
  mLuz: ['monthly', 'luz'],
  mAgua: ['monthly', 'agua'],
  mGas: ['monthly', 'gas'],
  mInternet: ['monthly', 'internet'],
  mOutros: ['monthly', 'outros'],
  mUnits: ['monthlyUnits'],
  hourRate: ['hourRate']
};

function fillSettings() {
  Object.entries(SETTINGS_FIELDS).forEach(([id, path]) => {
    const v = path.length === 2 ? settings[path[0]][path[1]] : settings[path[0]];
    $(id).value = !v ? '' : id === 'mUnits' ? String(v) : moneyToInput(v);
  });
}

function saveSettingsSoon() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => writeJSON(KEYS.settings, settings), 400);
}

// ---------------------------------------------------------------- rascunho automático
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => writeJSON(KEYS.draft, { recipe, dirty }), 400);
}

// ---------------------------------------------------------------- receitas salvas
function getRecipes() {
  const list = readJSON(KEYS.recipes, []);
  return Array.isArray(list) ? list : [];
}

function setRecipes(list) {
  return writeJSON(KEYS.recipes, list);
}

function saveRecipe(asNew = false) {
  if (!recipe.name.trim()) {
    toast('Dê um nome para a receita antes de salvar.', 'error');
    $('recipeName').focus();
    return;
  }
  const list = getRecipes();
  if (asNew || !recipe.id) recipe.id = newId();
  const record = { ...clone(recipe), updatedAt: new Date().toISOString() };
  const idx = list.findIndex((r) => r.id === recipe.id);
  if (idx >= 0) list[idx] = record; else list.unshift(record);
  if (!setRecipes(list)) return;

  saveToLibrary(recipe.ingredients);
  dirty = false;
  writeJSON(KEYS.draft, { recipe, dirty });
  renderSaved();
  renderSaveStatus();
  toast(idx >= 0 ? `"${recipe.name}" atualizada!` : `"${recipe.name}" salva no caderno!`);
}

function confirmDiscard() {
  return !dirty || confirm('A receita aberta tem alterações não salvas. Deseja continuar mesmo assim?');
}

function openRecipe(r, message) {
  recipe = normalizeRecipe(clone(r));
  dirty = false;
  fillForm();
  writeJSON(KEYS.draft, { recipe, dirty });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (message) toast(message);
}

function renderSaved() {
  const all = getRecipes().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const q = $('searchSaved').value.trim().toLowerCase();
  const list = q
    ? all.filter((r) => `${r.name} ${productLabel(normalizeRecipe(r))}`.toLowerCase().includes(q))
    : all;
  $('savedCount').textContent = String(all.length);

  if (!all.length) {
    $('savedList').innerHTML = '<div class="empty">Nenhuma receita salva ainda.<br>Preencha e clique em <b>Salvar receita</b>.</div>';
    return;
  }
  if (!list.length) {
    $('savedList').innerHTML = '<div class="empty">Nenhuma receita encontrada.</div>';
    return;
  }

  $('savedList').innerHTML = list.map((raw) => {
    const r = normalizeRecipe(raw);
    const c = compute(r);
    const label = productLabel(r);
    const date = raw.updatedAt
      ? new Date(raw.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : '';
    return `
      <div class="saved-item${raw.id === recipe.id ? ' current' : ''}" data-id="${esc(raw.id)}">
        <button type="button" class="saved-main" data-act="open" title="Abrir receita">
          <strong>${esc(r.name || 'Sem nome')}<span class="type-tag">${esc(capitalize(label))}</span></strong>
          <span>${c.units} un. · custo ${brl(c.unitCost)} · venda <b>${brl(c.price)}</b>${date ? ' · ' + date : ''}</span>
        </button>
        <div class="saved-actions">
          <button type="button" class="icon-btn dup" data-act="dup" title="Duplicar" aria-label="Duplicar">${ICONS.copy}</button>
          <button type="button" class="icon-btn" data-act="del" title="Excluir" aria-label="Excluir">${ICONS.trash}</button>
        </div>
      </div>`;
  }).join('');
}

function onSavedClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.saved-item').dataset.id;
  const found = getRecipes().find((r) => r.id === id);
  if (!found) return;

  if (btn.dataset.act === 'open') {
    if (found.id === recipe.id && !dirty) return;
    if (!confirmDiscard()) return;
    openRecipe(found, `"${found.name}" aberta.`);
  }

  if (btn.dataset.act === 'dup') {
    if (!confirmDiscard()) return;
    recipe = normalizeRecipe(clone(found));
    recipe.id = null;
    recipe.name = `${recipe.name} (cópia)`;
    dirty = true;
    fillForm();
    scheduleDraft();
    toast('Cópia criada. Ajuste e clique em Salvar.');
  }

  if (btn.dataset.act === 'del') {
    if (!confirm(`Excluir a receita "${found.name}"? Isso não pode ser desfeito.`)) return;
    setRecipes(getRecipes().filter((r) => r.id !== id));
    if (recipe.id === id) {
      recipe.id = null;
      dirty = true;
      scheduleDraft();
    }
    renderSaved();
    renderSaveStatus();
    toast('Receita excluída.');
  }
}

// ---------------------------------------------------------------- cadastro de insumos (preços)
function getLibrary() {
  const lib = readJSON(KEYS.library, {});
  return lib && typeof lib === 'object' && !Array.isArray(lib) ? lib : {};
}

function saveToLibrary(items) {
  const lib = getLibrary();
  items.forEach((it) => {
    const name = it.name.trim();
    if (name && parseNum(it.price) > 0 && parseNum(it.pkgQty) > 0) {
      lib[name.toLowerCase()] = { name, price: parseNum(it.price), pkgQty: parseNum(it.pkgQty), pkgUnit: it.pkgUnit };
    }
  });
  writeJSON(KEYS.library, lib);
  renderLibrary();
}

function renderLibrary() {
  $('ingLibrary').innerHTML = Object.values(getLibrary())
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((m) => `<option value="${esc(m.name)}">${esc(brl(m.price))} · ${esc(qty(m.pkgQty))} ${esc(m.pkgUnit)}</option>`)
    .join('');
}

// ---------------------------------------------------------------- backup
function exportBackup() {
  const data = {
    app: 'precificacao-doces',
    version: 3,
    exportedAt: new Date().toISOString(),
    recipes: getRecipes(),
    library: getLibrary(),
    settings,
    movements: typeof getMovements === 'function' ? getMovements() : [],
    stock: typeof getStock === 'function' ? getStock() : []
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-doces-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Backup baixado (${data.recipes.length} receitas, ${data.stock.length} compras no estoque).`);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : data.recipes;
      if (!Array.isArray(incoming)) throw new Error('formato');

      const list = getRecipes();
      let added = 0;
      let updated = 0;
      incoming.forEach((raw) => {
        const r = normalizeRecipe(raw);
        r.id = raw.id || newId();
        r.updatedAt = raw.updatedAt || new Date().toISOString();
        const idx = list.findIndex((x) => x.id === r.id);
        if (idx >= 0) { list[idx] = r; updated++; } else { list.push(r); added++; }
      });
      setRecipes(list);

      if (data.library && typeof data.library === 'object') {
        writeJSON(KEYS.library, { ...getLibrary(), ...data.library });
        renderLibrary();
      }
      if (data.settings) {
        settings = normalizeSettings(data.settings);
        writeJSON(KEYS.settings, settings);
        fillSettings();
      }
      let movMsg = '';
      if (Array.isArray(data.movements) && typeof getMovements === 'function') {
        const movs = getMovements();
        let movAdded = 0;
        data.movements.forEach((m) => {
          if (!m || !m.id) return;
          const idx = movs.findIndex((x) => x.id === m.id);
          if (idx >= 0) movs[idx] = m; else { movs.push(m); movAdded++; }
        });
        setMovements(movs);
        movMsg = ` e ${movAdded} lançamento(s) de vendas`;
      }
      if (Array.isArray(data.stock) && typeof getStock === 'function') {
        const st = getStock();
        let stAdded = 0;
        data.stock.forEach((l) => {
          if (!l || !l.id) return;
          const idx = st.findIndex((x) => x.id === l.id);
          if (idx >= 0) st[idx] = l; else { st.push(l); stAdded++; }
        });
        setStock(st);
        movMsg += ` e ${stAdded} compra(s) do estoque`;
      }
      renderSaved();
      update(false);
      if (typeof renderSales === 'function') renderSales();
      if (typeof renderStock === 'function') renderStock();
      toast(`Backup restaurado: ${added} receita(s) nova(s), ${updated} atualizada(s)${movMsg}.`);
    } catch (e) {
      toast('Arquivo inválido. Use um backup gerado por esta calculadora.', 'error');
    }
  };
  reader.readAsText(file);
}

/** Converte receitas da primeira versão da calculadora */
function migrateLegacy() {
  if (getRecipes().length) return;
  const old = readJSON(KEYS.legacy, null);
  if (!Array.isArray(old) || !old.length) return;
  const converted = old.map((o) => ({
    ...normalizeRecipe({
      name: o.name, yield: o.yield, size: o.volume, sizeUnit: 'ml',
      overhead: o.overhead, extra: o.fixedExtra, markup: o.markup,
      ingredients: (o.ingredients || []).map((i) => ({
        name: i.name, price: i.pkgPrice, pkgQty: i.pkgQty, pkgUnit: 'g', used: i.usedQty
      }))
    }),
    id: 'r' + o.id,
    updatedAt: new Date().toISOString()
  }));
  if (setRecipes(converted)) toast(`${converted.length} receita(s) da versão antiga foram recuperadas.`);
}

// ---------------------------------------------------------------- WhatsApp e impressão
function buildSummaryText() {
  const c = compute(recipe);
  const label = productLabel(recipe);
  const items = recipe.ingredients
    .filter((i) => i.name.trim())
    .map((i) => `• ${i.name}: ${qty(parseNum(i.used))} ${baseUnit(i.pkgUnit)} — ${brl(itemCost(i))}`);
  const extras = [];
  if (c.overheadVal > 0) extras.push(`Água, luz e gás: ${brl(c.overheadVal)}`);
  if (c.labor > 0) extras.push(`Mão de obra: ${brl(c.labor)}`);
  if (c.extra > 0) extras.push(`Outro gasto: ${brl(c.extra)}`);
  return [
    `*${(recipe.name.trim() || 'Receita').toUpperCase()}*`,
    `Rendimento: ${c.units} unidades` + (parseNum(recipe.size) ? ` de ${qty(parseNum(recipe.size))} ${recipe.sizeUnit}` : ''),
    '',
    '*Ingredientes*',
    ...items,
    `Valor dos ingredientes: ${brl(c.ingTotal)}`,
    ...(extras.length ? ['', '*Custos adicionais*', ...extras] : []),
    '',
    `Custo total: ${brl(c.totalCost)}`,
    `Massa total: ${qty(c.mass)} g/ml (${qty(c.massPerUnit)} por ${label})`,
    `Custo por ${label}: ${brl(c.unitCost)}`,
    `Preço de venda: *${brl(c.price)}* (+${pct(c.effMarkup)})`,
    `Lucro por ${label}: ${brl(c.unitProfit)}`,
    `Lucro da receita: *${brl(c.totalProfit)}*`
  ].join('\n');
}

async function copySummary() {
  const text = buildSummaryText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Resumo copiado! É só colar no WhatsApp.');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    toast(ok ? 'Resumo copiado! É só colar no WhatsApp.' : 'Não foi possível copiar.', ok ? 'success' : 'error');
  }
}

function printSheet() {
  setText('printDate', `${recipe.name || 'Receita'} · ${new Date().toLocaleDateString('pt-BR')}`);
  window.print();
}

// ---------------------------------------------------------------- eventos
function setMarkup(value) {
  recipe.markup = Math.max(0, value);
  recipe.priceMode = 'markup';
  update(true);
}

function bindEvents() {
  // Dados da receita
  const fields = {
    recipeName: 'name', productType: 'type', recipeYield: 'yield', unitSize: 'size',
    sizeUnit: 'sizeUnit', overheadPercent: 'overhead', laborMinutes: 'laborMinutes', extraCost: 'extra'
  };
  const textFields = ['name', 'type', 'sizeUnit'];
  Object.entries(fields).forEach(([id, key]) => {
    $(id).addEventListener('input', (e) => {
      recipe[key] = textFields.includes(key) ? e.target.value : parseNum(e.target.value);
      update(true);
      if (key === 'name' || key === 'type') renderSaved();
    });
  });

  document.querySelectorAll('input[name="ohMode"]').forEach((el) => {
    el.addEventListener('change', () => {
      recipe.overheadMode = el.value;
      update(true);
    });
  });

  // Contas do mês e valor da hora (globais)
  Object.entries(SETTINGS_FIELDS).forEach(([id, path]) => {
    $(id).addEventListener('input', (e) => {
      const v = Math.max(0, parseNum(e.target.value));
      if (path.length === 2) settings[path[0]][path[1]] = v;
      else settings[path[0]] = id === 'mUnits' ? Math.round(v) : v;
      saveSettingsSoon();
      update(false);
      renderSaved();
    });
  });

  // Tabela de ingredientes (delegação de eventos)
  const body = $('ingBody');
  body.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const i = Number(e.target.closest('tr').dataset.i);
    const it = recipe.ingredients[i];
    if (!it) return;
    it[f] = f === 'name' || f === 'pkgUnit' ? e.target.value : parseNum(e.target.value);
    updateRow(i);
    update(true);
  });
  body.addEventListener('change', (e) => {
    if (e.target.dataset.f === 'name') fillFromLibrary(Number(e.target.closest('tr').dataset.i));
  });
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="remove"]');
    if (!btn) return;
    recipe.ingredients.splice(Number(btn.closest('tr').dataset.i), 1);
    if (!recipe.ingredients.length) recipe.ingredients.push(blankIngredient());
    renderIngredients();
    update(true);
  });
  // Enter no último campo "usado" cria uma nova linha
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.dataset.f !== 'used') return;
    const i = Number(e.target.closest('tr').dataset.i);
    if (i === recipe.ingredients.length - 1) {
      e.preventDefault();
      addIngredient();
    }
  });

  // Precificação
  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) setMarkup(Number(chip.dataset.m));
  });
  $('markupSlider').addEventListener('input', (e) => setMarkup(Number(e.target.value)));
  $('markupInput').addEventListener('input', (e) => setMarkup(parseNum(e.target.value)));
  $('priceInput').addEventListener('input', (e) => {
    recipe.priceMode = 'manual';
    recipe.manualPrice = parseNum(e.target.value);
    update(true);
  });
  $('priceInput').addEventListener('blur', () => update(false));
  $('markupInput').addEventListener('blur', () => update(false));
  $('roundUp').addEventListener('change', (e) => {
    recipe.roundUp = e.target.checked;
    if (recipe.priceMode === 'manual') {
      recipe.markup = Math.round(compute(recipe).effMarkup);
      recipe.priceMode = 'markup';
    }
    update(true);
  });

  // Botões gerais
  $('btnAddIng').addEventListener('click', addIngredient);
  $('btnSave').addEventListener('click', () => saveRecipe(false));
  $('btnSaveAs').addEventListener('click', () => saveRecipe(true));
  $('btnCopy').addEventListener('click', copySummary);
  $('btnPrint').addEventListener('click', printSheet);

  $('btnNew').addEventListener('click', () => {
    if (!confirmDiscard()) return;
    recipe = blankRecipe();
    dirty = false;
    fillForm();
    writeJSON(KEYS.draft, { recipe, dirty });
    $('recipeName').focus();
  });
  document.querySelectorAll('[data-example]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ex = EXAMPLES[btn.dataset.example];
      if (!ex || !confirmDiscard()) return;
      openRecipe(ex, `Exemplo "${ex.name}" carregado (só fica salvo se você salvar).`);
    });
  });

  // Receitas salvas e backup
  $('savedList').addEventListener('click', onSavedClick);
  $('searchSaved').addEventListener('input', renderSaved);
  $('btnExport').addEventListener('click', exportBackup);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importBackup(file);
    e.target.value = '';
  });

  // Garante que tudo seja gravado ao fechar
  window.addEventListener('beforeunload', () => {
    clearTimeout(draftTimer);
    clearTimeout(settingsTimer);
    try {
      localStorage.setItem(KEYS.draft, JSON.stringify({ recipe, dirty }));
      localStorage.setItem(KEYS.settings, JSON.stringify(settings));
    } catch (e) { /* sem espaço */ }
  });
}

// ---------------------------------------------------------------- início
document.addEventListener('DOMContentLoaded', () => {
  migrateLegacy();
  settings = normalizeSettings(readJSON(KEYS.settings, null));

  const draft = readJSON(KEYS.draft, null);
  if (draft && draft.recipe) {
    recipe = normalizeRecipe(draft.recipe);
    dirty = !!draft.dirty;
  } else {
    recipe = normalizeRecipe(clone(EXAMPLES.geladinho));
    dirty = false;
  }

  bindEvents();
  renderLibrary();
  fillSettings();
  fillForm();
});
