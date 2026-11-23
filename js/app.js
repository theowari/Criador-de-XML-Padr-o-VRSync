/*
 * Formulário: estado, ligação dos campos (data-bind), mídia, features,
 * persistência local e geração/download do XML.
 */
(function () {
  'use strict';

  const V = window.VRSYNC;
  const X = window.VRSyncXml;
  const VAL = window.VRSyncValidate;
  const IMP = window.VRSyncImport;
  const STORAGE_KEY = 'vrsync-generator-state-v1';
  const PROXY_KEY = 'vrsync-generator-proxy-v1';

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ------------------------------------------------------------------ estado

  function emptyLocation() {
    return { country: 'Brasil', countryAbbr: 'BR', state: '', stateName: '', city: '', neighborhood: '', address: '', postalCode: '' };
  }

  function newListing(n) {
    return {
      listingId: 'IMOVEL-' + String(n).padStart(3, '0'),
      title: '',
      transactionType: 'For Sale',
      publicationType: 'STANDARD',
      detailViewUrl: '',
      virtualTourLink: '',
      media: [],
      details: {
        usageType: 'Residential',
        propertyType: '',
        description: '',
        listPrice: '', rentalPrice: '', rentalPeriod: 'Monthly',
        adminFee: '', iptu: '', iptuPeriod: 'Yearly', sendYearlyTax: false,
        livingArea: '', lotArea: '',
        bedrooms: '', bathrooms: '', suites: '', garage: '',
        floors: '', unitFloor: '', buildings: '', yearBuilt: '',
        features: [],
        warranties: [],
      },
      location: Object.assign(emptyLocation(), {
        displayAddress: 'All', zone: '', streetNumber: '', complement: '', latitude: '', longitude: '',
      }),
      contact: {
        useOwn: false, name: '', email: '', website: '', logo: '', officeName: '', telephone: '',
        location: emptyLocation(),
      },
    };
  }

  function defaultState() {
    return {
      settings: { encoding: 'UTF-8', useCdata: true, newlinesToBr: true, garageTypeAttr: true },
      header: { provider: '', email: '', contactName: '', telephone: '', publishDate: '', autoDate: true },
      contact: { name: '', email: '', website: '', logo: '', officeName: '', telephone: '', location: emptyLocation() },
      listings: [newListing(1)],
      current: 0,
    };
  }

  // Completa objetos salvos com campos novos que não existiam quando foram gravados.
  function mergeDefaults(target, defaults) {
    Object.keys(defaults).forEach(function (k) {
      const dv = defaults[k];
      if (target[k] === undefined || target[k] === null) target[k] = JSON.parse(JSON.stringify(dv));
      else if (dv && typeof dv === 'object' && !Array.isArray(dv)) mergeDefaults(target[k], dv);
    });
    return target;
  }

  function normalize(s) {
    s = mergeDefaults(s || {}, Object.assign(defaultState(), { listings: [] }));
    if (!Array.isArray(s.listings) || !s.listings.length) s.listings = [newListing(1)];
    s.listings = s.listings.map(function (l, i) { return mergeDefaults(l, newListing(i + 1)); });
    if (!(s.current >= 0 && s.current < s.listings.length)) s.current = 0;
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* armazenamento indisponível */ }
    return defaultState();
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      let saved = true;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { saved = false; }
      // Um XML importado com muitos imóveis pode passar do limite do armazenamento do navegador.
      $('#storage-warning').hidden = saved;
    }, 300);
  }

  let state = load();
  function current() { return state.listings[state.current]; }

  // ------------------------------------------------------------------ binding

  function resolve(path) {
    const parts = path.split('.');
    let obj = parts[0] === 'listing' ? current() : state[parts[0]];
    for (let i = 1; i < parts.length - 1; i++) obj = obj[parts[i]];
    return { obj: obj, key: parts[parts.length - 1] };
  }

  function getPath(path) {
    const r = resolve(path);
    return r.obj[r.key];
  }

  function setPath(path, value) {
    const r = resolve(path);
    r.obj[r.key] = value;
  }

  function fillOptions(select, list, emptyLabel) {
    select.innerHTML = '';
    if (emptyLabel !== undefined) select.add(new Option(emptyLabel, ''));
    list.forEach(function (o) {
      const label = o[0] === o[1] ? o[0] : o[0] + ' — ' + o[1];
      select.add(new Option(label, o[0]));
    });
  }

  function buildSelects() {
    $$('select[data-options]').forEach(function (sel) {
      fillOptions(sel, V[sel.dataset.options], sel.dataset.empty);
    });

    const pt = $('#property-type-select');
    pt.add(new Option('— selecione —', ''));
    [['Residential', 'Residencial'], ['Commercial', 'Comercial']].forEach(function (g) {
      const group = document.createElement('optgroup');
      group.label = g[1];
      V.PROPERTY_TYPES.filter(function (p) { return p.value.indexOf(g[0]) === 0; }).forEach(function (p) {
        const portals = p.onlyInRequirementTables
          ? '(citado só nas tabelas de banheiros/quartos)'
          : 'VivaReal: ' + p.vivareal + ' | ZAP: ' + p.zap;
        group.appendChild(new Option(p.value + ' — ' + portals, p.value));
      });
      pt.appendChild(group);
    });
  }

  function fillForm() {
    $$('[data-bind]').forEach(function (el) {
      const v = getPath(el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v === undefined || v === null ? '' : v;
    });
    renderMedia();
    syncChecks();
    refreshDerived();
  }

  function onBoundInput(el) {
    const path = el.dataset.bind;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    setPath(path, value);

    // O nome do estado acompanha a UF escolhida.
    if (/location\.state$/.test(path)) {
      const st = V.STATES.find(function (s) { return s[0] === value; });
      setPath(path + 'Name', st ? st[1] : '');
    }
    if (path === 'listing.listingId' || path === 'listing.title') updatePickerLabel();
    refreshDerived();
    save();
  }

  // ------------------------------------------------------------------ campos derivados

  function refreshDerived() {
    const l = current();
    const tt = l.transactionType;
    const flags = {
      sale: tt === 'For Sale' || tt === 'Sale/Rent',
      rent: tt === 'For Rent' || tt === 'Sale/Rent',
      ownContact: !!l.contact.useOwn,
    };
    $$('[data-show-when]').forEach(function (el) { el.hidden = !flags[el.dataset.showWhen]; });

    const pt = V.propertyType(l.details.propertyType);
    const req = {
      livingArea: !pt || pt.area === 'LivingArea',
      lotArea: !!pt && pt.area === 'LotArea',
      bedrooms: !!pt && pt.bedrooms,
      bathrooms: !!pt && pt.bathrooms,
    };
    $$('[data-req]').forEach(function (el) { el.hidden = !req[el.dataset.req]; });

    let hint = '';
    if (pt) {
      hint = pt.onlyInRequirementTables
        ? 'Atenção: valor não listado na tabela oficial de PropertyType.'
        : 'VivaReal: ' + pt.vivareal + ' · ZAP: ' + pt.zap;
      hint += ' · Área exigida: ' + (pt.area === 'LotArea' ? 'Área total (LotArea)' : 'Área útil (LivingArea)');
      if (pt.complement) hint += ' · Recomenda-se informar o complemento do endereço.';
    }
    $('#property-type-hint').textContent = hint;

    const bedroomsInput = $('[data-bind="listing.details.bedrooms"]');
    const kitnet = !!(pt && pt.bedroomsFixedZero);
    bedroomsInput.disabled = kitnet;
    if (kitnet) bedroomsInput.value = '0';
    else if (bedroomsInput.value !== String(l.details.bedrooms)) bedroomsInput.value = l.details.bedrooms;
    $('#bedrooms-hint').textContent = kitnet
      ? 'Kitnet: Bedrooms é sempre 0.'
      : (pt && pt.value === 'Residential / Studio' ? 'Studio: obrigatório, mínimo 0.' : '');

    $('#df-hint').hidden = l.location.state !== 'DF';

    const title = String(l.title || '').trim().length;
    $('[data-counter="listing.title"]').textContent = '(' + title + '/100)';
    const desc = String(l.details.description || '');
    const plain = VAL.descriptionPlain(desc).length;
    const sent = X.descriptionContent(desc, state.settings.newlinesToBr).length;
    $('#description-counter').textContent = 'Texto: ' + plain + ' caracteres · enviado com formatação: ' + sent + '/3000.';
  }

  // ------------------------------------------------------------------ seletor de imóveis

  function listingLabel(l, i) {
    return '#' + (i + 1) + ' · ' + (l.listingId || '(sem código)') + ' · ' + (l.title || '(sem título)');
  }

  function renderPicker() {
    const picker = $('#listing-picker');
    picker.innerHTML = '';
    state.listings.forEach(function (l, i) { picker.add(new Option(listingLabel(l, i), String(i))); });
    picker.value = String(state.current);
    $('#listing-count').textContent = state.listings.length + ' imóvel(is) no arquivo';
    $('#btn-remove-listing').disabled = state.listings.length < 2;
  }

  // Atualiza só o rótulo do imóvel em edição (refazer a lista inteira a cada tecla pesa com muitos imóveis).
  function updatePickerLabel() {
    const opt = $('#listing-picker').options[state.current];
    if (opt) opt.text = listingLabel(current(), state.current);
  }

  function selectListing(i) {
    state.current = i;
    renderPicker();
    fillForm();
    save();
  }

  function nextListingNumber() {
    return state.listings.length + 1;
  }

  // ------------------------------------------------------------------ mídia

  function renderMedia() {
    const tbody = $('#media-rows');
    tbody.innerHTML = '';
    current().media.forEach(function (m, i) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td><select data-media="medium"></select></td>' +
        '<td><input type="url" data-media="url" placeholder="https://"></td>' +
        '<td><input type="text" data-media="caption"></td>' +
        '<td><input type="checkbox" data-media="primary"></td>' +
        '<td class="nowrap"><button type="button" data-media-action="up" title="Subir">↑</button>' +
        '<button type="button" data-media-action="down" title="Descer">↓</button>' +
        '<button type="button" data-media-action="remove" title="Remover">✕</button></td>';
      tr.dataset.index = String(i);
      const sel = $('select', tr);
      fillOptions(sel, V.MEDIUMS);
      sel.value = m.medium;
      $('[data-media="url"]', tr).value = m.url;
      const caption = $('[data-media="caption"]', tr);
      const primary = $('[data-media="primary"]', tr);
      caption.value = m.caption || '';
      primary.checked = !!m.primary;
      // caption e primary só existem para fotos
      caption.disabled = primary.disabled = m.medium !== 'image';
      tbody.appendChild(tr);
    });
  }

  function addMedia(items) {
    const media = current().media;
    items.forEach(function (it) {
      const isFirstImage = it.medium === 'image' && !media.some(function (m) { return m.medium === 'image'; });
      media.push({ medium: it.medium, url: it.url || '', caption: '', primary: isFirstImage });
    });
    renderMedia();
    save();
  }

  function onMediaInput(el) {
    const tr = el.closest('tr');
    const i = Number(tr.dataset.index);
    const media = current().media;
    const field = el.dataset.media;
    if (field === 'primary') {
      media.forEach(function (m, k) { m.primary = k === i ? el.checked : false; });
      renderMedia();
    } else {
      media[i][field] = el.value;
      if (field === 'medium') {
        if (el.value !== 'image') { media[i].primary = false; media[i].caption = ''; }
        renderMedia();
      }
    }
    save();
  }

  function onMediaAction(btn) {
    const i = Number(btn.closest('tr').dataset.index);
    const media = current().media;
    const action = btn.dataset.mediaAction;
    if (action === 'remove') media.splice(i, 1);
    if (action === 'up' && i > 0) media.splice(i - 1, 0, media.splice(i, 1)[0]);
    if (action === 'down' && i < media.length - 1) media.splice(i + 1, 0, media.splice(i, 1)[0]);
    renderMedia();
    save();
  }

  // ------------------------------------------------------------------ features e garantias

  function buildChecks(container, list, name) {
    container.innerHTML = '';
    list.forEach(function (o) {
      const label = document.createElement('label');
      label.className = 'check';
      label.dataset.search = (o[0] + ' ' + o[1]).toLowerCase();
      label.innerHTML = '<input type="checkbox"> <span></span> <code></code>';
      const input = $('input', label);
      input.value = o[0];
      input.dataset.list = name;
      $('span', label).textContent = o[1];
      $('code', label).textContent = o[0];
      container.appendChild(label);
    });
  }

  function knownFeatures() {
    return V.FEATURES.concat(V.FEATURES_FROM_EXAMPLES).map(function (f) { return f[0]; });
  }

  function syncChecks() {
    const d = current().details;
    $$('input[data-list]').forEach(function (input) {
      input.checked = d[input.dataset.list].indexOf(input.value) >= 0;
    });
    $('#feature-count').textContent = d.features.length + ' selecionada(s)';

    const known = knownFeatures();
    const custom = d.features.filter(function (f) { return known.indexOf(f) < 0; });
    const holder = $('#features-custom-list');
    holder.innerHTML = '';
    custom.forEach(function (f) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.removeFeature = f;
      chip.textContent = f + ' ✕';
      holder.appendChild(chip);
    });
  }

  function toggleListValue(list, value, on) {
    const arr = current().details[list];
    const pos = arr.indexOf(value);
    if (on && pos < 0) arr.push(value);
    if (!on && pos >= 0) arr.splice(pos, 1);
    syncChecks();
    save();
  }

  // ------------------------------------------------------------------ descrição

  const DESC_TOKENS = { br: '&lt;br&gt;', bull: '&bull; ' };

  function editDescription(fn) {
    const ta = $('#description');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const r = fn(ta.value.slice(0, start), ta.value.slice(start, end), ta.value.slice(end));
    ta.value = r.text;
    ta.focus();
    ta.setSelectionRange(r.caret, r.caret);
    onBoundInput(ta);
  }

  // ------------------------------------------------------------------ geração

  let lastXml = '';

  function fieldElement(field) {
    if (!field) return null;
    if (field === 'listing.media') return $('#media-rows input') || $('#btn-add-media');
    if (field === 'listing.details.warranties') return $('#warranties input');
    return $('[data-bind="' + field + '"]');
  }

  function goToIssue(issue) {
    if (issue.listing !== null && issue.listing !== state.current) selectListing(issue.listing);
    const el = fieldElement(issue.field);
    if (!el) return;
    const det = el.closest('details');
    if (det) det.open = true;
    el.scrollIntoView({ block: 'center' });
    el.focus();
  }

  function renderIssues(issues) {
    const ul = $('#issues');
    ul.innerHTML = '';
    issues.forEach(function (issue) {
      const li = document.createElement('li');
      li.className = issue.level;
      const where = issue.listing === null ? 'Arquivo' : listingLabel(state.listings[issue.listing], issue.listing);
      li.textContent = (issue.level === 'error' ? 'ERRO' : 'Aviso') + ' — ' + where + ': ' + issue.message;
      li.addEventListener('click', function () { goToIssue(issue); });
      ul.appendChild(li);
    });
  }

  function generate() {
    const issues = VAL.validate(state);
    issues.sort(function (a, b) { return (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1); });
    renderIssues(issues);
    lastXml = X.generate(state);
    $('#output').value = lastXml;
    const errors = issues.filter(function (i) { return i.level === 'error'; }).length;
    const warnings = issues.length - errors;
    $('#status').textContent = errors
      ? errors + ' erro(s) e ' + warnings + ' aviso(s). O XML foi gerado, mas o portal deve recusar os itens com erro.'
      : (warnings ? 'XML gerado com ' + warnings + ' aviso(s).' : 'XML gerado sem erros.');
    return lastXml;
  }

  function timestamp() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function download() {
    const xml = generate();
    const enc = state.settings.encoding;
    const mime = 'application/xml;charset=' + (enc === 'ISO8859-1' ? 'ISO-8859-1' : 'UTF-8');
    downloadBlob(new Blob([X.encode(xml, enc)], { type: mime }), 'vrsync-' + timestamp() + '.xml');
  }

  function copy() {
    const xml = lastXml || generate();
    const fallback = function () {
      const out = $('#output');
      out.focus();
      out.select();
      document.execCommand('copy');
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(xml).then(function () { $('#status').textContent = 'XML copiado.'; }, fallback);
    } else {
      fallback();
      $('#status').textContent = 'XML copiado.';
    }
  }

  // ------------------------------------------------------------------ importar XML por link

  function isPristine() {
    return JSON.stringify(state) === JSON.stringify(defaultState());
  }

  // O resultado antigo não vale mais depois que o projeto é trocado.
  function resetOutput() {
    lastXml = '';
    $('#output').value = '';
    $('#issues').innerHTML = '';
    $('#status').textContent = '';
  }

  function showImportStatus(kind, message, hint) {
    const p = $('#import-status');
    p.innerHTML = '';
    p.hidden = !message;
    p.className = 'import-status ' + kind;
    if (!message) return;
    const strong = document.createElement('strong');
    strong.textContent = message;
    p.appendChild(strong);
    if (hint) {
      const span = document.createElement('span');
      span.className = 'import-hint';
      span.textContent = hint;
      p.appendChild(span);
    }
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function renderImportReport(report) {
    const box = $('#import-report');
    box.innerHTML = '';
    box.hidden = false;

    const ok = document.createElement('p');
    ok.className = 'import-ok';
    let host = report.url;
    try { host = new URL(report.url).host; } catch (e) { /* mantém a URL inteira */ }
    ok.textContent = '✓ ' + plural(report.listings, 'imóvel carregado', 'imóveis carregados') + ' de ' + host +
      (report.via === 'proxy' ? ' (pelo proxy)' : '') + '. Revise os dados, edite o que precisar e gere o XML no passo 5.';
    box.appendChild(ok);

    const facts = document.createElement('ul');
    facts.className = 'import-facts';
    const addFact = function (t) { const li = document.createElement('li'); li.textContent = t; facts.appendChild(li); };
    addFact('Encoding do arquivo: ' + report.encoding + '. O cabeçalho e a imobiliária foram preenchidos a partir do XML; a data de publicação será a do momento em que você gerar o novo arquivo.');
    if (report.ownContacts) {
      addFact(plural(report.ownContacts, 'imóvel tem', 'imóveis têm') + ' um contato diferente do da imobiliária e ficou com contato próprio.');
    }
    box.appendChild(facts);

    const attention = [];
    report.notes.forEach(function (n) {
      attention.push(n.message + (n.count ? ' (' + plural(n.count, 'imóvel', 'imóveis') + ')' : ''));
    });
    if (report.ignored.length) {
      const total = report.ignored.reduce(function (s, x) { return s + x.count; }, 0);
      attention.push('Elementos do XML que este formulário não representa e que não vão para o novo arquivo (' + total + ' no total): ' +
        report.ignored.slice(0, 8).map(function (x) { return x.path + ' ×' + x.count; }).join(', ') +
        (report.ignored.length > 8 ? ' e mais ' + (report.ignored.length - 8) + ' tipo(s)' : '') + '.');
    }
    if (attention.length) {
      const det = document.createElement('details');
      det.className = 'collapsible';
      det.open = true;
      const sum = document.createElement('summary');
      sum.textContent = 'Pontos de atenção (' + attention.length + ')';
      det.appendChild(sum);
      const ul = document.createElement('ul');
      ul.className = 'import-notes';
      attention.forEach(function (t) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      det.appendChild(ul);
      box.appendChild(det);
    }
  }

  let importing = false;
  async function importFromUrl() {
    if (importing) return;
    const button = $('#btn-import-url');
    importing = true;
    button.disabled = true;
    $('#import-report').hidden = true;
    showImportStatus('loading', 'Carregando o XML…');
    try {
      const result = await IMP.loadFromUrl($('#import-url').value, {
        proxy: $('#import-proxy').value,
        onStatus: function (msg) { showImportStatus('loading', msg); },
      });
      if (!isPristine() && !confirm('Carregar este XML substitui o projeto atual (imóveis, cabeçalho e imobiliária). Continuar?')) {
        showImportStatus('', '');
        return;
      }
      state = normalize(result.project);
      resetOutput();
      renderPicker();
      fillForm();
      save();
      showImportStatus('', '');
      renderImportReport(result.report);
    } catch (e) {
      if (e && e.name === 'ImportError') {
        showImportStatus('error', e.message, e.hint);
        if (e.code === 'network') $('#import-advanced').open = true;
      } else {
        showImportStatus('error', 'Erro inesperado ao ler o XML.', e && e.message);
      }
    } finally {
      importing = false;
      button.disabled = false;
    }
  }

  // ------------------------------------------------------------------ eventos

  function wire() {
    document.addEventListener('input', function (e) {
      const el = e.target;
      if (el.dataset.bind) onBoundInput(el);
      else if (el.dataset.media && el.type !== 'checkbox' && el.tagName !== 'SELECT') onMediaInput(el);
    });
    document.addEventListener('change', function (e) {
      const el = e.target;
      if (el.dataset.bind && (el.type === 'checkbox' || el.tagName === 'SELECT')) onBoundInput(el);
      else if (el.dataset.media && (el.type === 'checkbox' || el.tagName === 'SELECT')) onMediaInput(el);
      else if (el.dataset.list) toggleListValue(el.dataset.list, el.value, el.checked);
    });
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.mediaAction) onMediaAction(btn);
      if (btn.dataset.removeFeature) toggleListValue('features', btn.dataset.removeFeature, false);
      if (btn.dataset.descInsert) {
        const token = DESC_TOKENS[btn.dataset.descInsert];
        editDescription(function (a, sel, b) { return { text: a + token + sel + b, caret: (a + token + sel).length }; });
      }
      if (btn.dataset.descWrap) {
        const t = btn.dataset.descWrap;
        const open = '&lt;' + t + '&gt;';
        const close = '&lt;/' + t + '&gt;';
        editDescription(function (a, sel, b) { return { text: a + open + sel + close + b, caret: (a + open + sel).length }; });
      }
    });

    $('#listing-picker').addEventListener('change', function (e) { selectListing(Number(e.target.value)); });
    $('#btn-add-listing').addEventListener('click', function () {
      state.listings.push(newListing(nextListingNumber()));
      selectListing(state.listings.length - 1);
    });
    $('#btn-duplicate-listing').addEventListener('click', function () {
      const copyOf = JSON.parse(JSON.stringify(current()));
      copyOf.listingId = (copyOf.listingId || 'IMOVEL') + '-COPIA';
      state.listings.splice(state.current + 1, 0, copyOf);
      selectListing(state.current + 1);
    });
    $('#btn-remove-listing').addEventListener('click', function () {
      if (state.listings.length < 2) return;
      if (!confirm('Remover o imóvel "' + listingLabel(current(), state.current) + '"?')) return;
      state.listings.splice(state.current, 1);
      selectListing(Math.min(state.current, state.listings.length - 1));
    });

    $('#btn-add-media').addEventListener('click', function () { addMedia([{ medium: 'image', url: '' }]); });
    $('#btn-add-media-bulk').addEventListener('click', function () {
      const ta = $('#media-bulk');
      const urls = ta.value.split(/\s+/).map(function (u) { return u.trim(); }).filter(Boolean);
      addMedia(urls.map(function (u) { return { medium: IMP.guessMedium(u), url: u }; }));
      ta.value = '';
    });

    $('#feature-filter').addEventListener('input', function (e) {
      const q = e.target.value.trim().toLowerCase();
      $$('#features label, #features-extra label').forEach(function (l) {
        l.hidden = q !== '' && l.dataset.search.indexOf(q) < 0;
      });
    });
    $('#btn-clear-features').addEventListener('click', function () {
      current().details.features = [];
      syncChecks();
      save();
    });
    $('#btn-add-feature-custom').addEventListener('click', function () {
      const input = $('#feature-custom');
      const v = input.value.trim();
      if (v) toggleListValue('features', v, true);
      input.value = '';
    });

    $('#btn-import-url').addEventListener('click', importFromUrl);
    $('#import-url').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); importFromUrl(); }
    });
    $('#import-proxy').addEventListener('input', function (e) {
      try { localStorage.setItem(PROXY_KEY, e.target.value.trim()); } catch (err) { /* ignora */ }
    });

    $('#btn-generate').addEventListener('click', generate);
    $('#btn-download').addEventListener('click', download);
    $('#btn-copy').addEventListener('click', copy);

    $('#btn-new-project').addEventListener('click', function () {
      if (!confirm('Apagar todos os dados preenchidos e começar um novo projeto?')) return;
      state = defaultState();
      renderPicker();
      fillForm();
      save();
    });
    $('#btn-export-json').addEventListener('click', function () {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      downloadBlob(blob, 'vrsync-projeto-' + timestamp() + '.json');
    });
    $('#input-import-json').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        state = normalize(JSON.parse(text));
        renderPicker();
        fillForm();
        save();
      }).catch(function () {
        alert('Arquivo de projeto inválido.');
      });
      e.target.value = '';
    });
  }

  // ------------------------------------------------------------------ início

  buildSelects();
  buildChecks($('#features'), V.FEATURES, 'features');
  buildChecks($('#features-extra'), V.FEATURES_FROM_EXAMPLES, 'features');
  buildChecks($('#warranties'), V.WARRANTIES, 'warranties');
  wire();
  try { $('#import-proxy').value = localStorage.getItem(PROXY_KEY) || ''; } catch (e) { /* ignora */ }
  renderPicker();
  fillForm();
})();
