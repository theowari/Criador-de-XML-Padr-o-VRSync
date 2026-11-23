/*
 * Importação de um XML VRSync existente.
 * Baixa o arquivo a partir de um link, lê o XML e devolve o estado do projeto
 * (o mesmo formato do .json exportado). É o caminho inverso de xml.js.
 *
 * Nada aqui mexe na tela: app.js cuida da interface.
 */
window.VRSyncImport = (function () {
  'use strict';

  const V = window.VRSYNC;
  const TIMEOUT_MS = 60000;

  function ImportError(code, message, hint) {
    const e = new Error(message);
    e.name = 'ImportError';
    e.code = code;
    e.hint = hint || '';
    return e;
  }

  // ------------------------------------------------------------------ texto

  // Sem acento, minúsculo, espaços colapsados: "Residential/ Apartment" ≈ "residential / apartment".
  function fold(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function squash(s) {
    return fold(s).replace(/ /g, '');
  }

  function guessMedium(url) {
    if (/youtube\.com|youtu\.be/i.test(url)) return 'video';
    if (/\.(mp4|mov)(\?|#|$)/i.test(url)) return 'reel';
    return 'image';
  }

  // O campo do formulário (datetime-local) só aceita AAAA-MM-DDTHH:MM[:SS], sem fuso.
  function dateTimeLocal(v) {
    const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
    return m ? m[1] + 'T' + m[2] + ':' + (m[3] || '00') : '';
  }

  // ------------------------------------------------------------------ leitura do DOM

  function elementsOf(el) {
    const out = [];
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
    return out;
  }
  // O feed oficial usa namespace; alguns geradores omitem. Comparar só o nome local atende os dois.
  function nameOf(el) {
    return el.localName || String(el.nodeName).replace(/^.*:/, '');
  }
  function kids(el, tag) {
    return el ? elementsOf(el).filter(function (e) { return nameOf(e) === tag; }) : [];
  }
  function kid(el, tag) {
    return kids(el, tag)[0] || null;
  }
  function text(el) {
    return el ? String(el.textContent).trim() : '';
  }
  function textOf(el, tag) {
    return text(kid(el, tag));
  }
  function attrOf(el, a) {
    return el ? String(el.getAttribute(a) || '').trim() : '';
  }

  // ------------------------------------------------------------------ elementos conhecidos

  function leaves(names) {
    const o = {};
    names.forEach(function (n) { o[n] = null; });
    return o;
  }
  const BASE_LOCATION = ['Country', 'State', 'City', 'Neighborhood', 'Address', 'PostalCode'];
  const SCHEMA = {
    Header: leaves(['Provider', 'Email', 'ContactName', 'PublishDate', 'Telephone']),
    Listings: {
      Listing: Object.assign(leaves(['ListingID', 'Title', 'TransactionType', 'PublicationType', 'DetailViewUrl', 'VirtualTourLink']), {
        Media: { Item: null },
        Details: Object.assign(leaves([
          'UsageType', 'PropertyType', 'Description', 'ListPrice', 'RentalPrice', 'LotArea', 'LivingArea',
          'PropertyAdministrationFee', 'Iptu', 'YearlyTax', 'Bedrooms', 'Bathrooms', 'Suites', 'Garage',
          'Floors', 'UnitFloor', 'Buildings', 'YearBuilt',
        ]), { Features: { Feature: null }, Warranties: { Warranty: null } }),
        Location: leaves(BASE_LOCATION.concat(['Zone', 'StreetNumber', 'Complement', 'Latitude', 'Longitude'])),
        ContactInfo: Object.assign(leaves(['Name', 'Email', 'Website', 'Logo', 'OfficeName', 'Telephone']), {
          Location: leaves(BASE_LOCATION),
        }),
      }),
    },
  };

  // Registra os elementos que o formulário não representa, para o usuário saber o que não veio.
  function findIgnored(el, schema, path, ignored) {
    elementsOf(el).forEach(function (child) {
      const n = nameOf(child);
      const sub = Object.prototype.hasOwnProperty.call(schema, n) ? schema[n] : undefined;
      const p = path + '/' + n;
      if (sub === undefined) ignored[p] = (ignored[p] || 0) + 1;
      else if (sub !== null) findIgnored(child, sub, p, ignored);
    });
  }

  // ------------------------------------------------------------------ avisos

  // Avisos iguais são agrupados (um feed com 2 mil imóveis não vira 2 mil linhas).
  function note(ctx, idx, message) {
    const e = ctx.notes[message] || (ctx.notes[message] = { message: message, listings: [] });
    if (e.listings.indexOf(idx) < 0) e.listings.push(idx);
  }

  function pick(ctx, idx, field, raw, values, fallback) {
    if (raw === '') return fallback;
    const key = squash(raw);
    const hit = values.find(function (v) { return squash(v) === key; });
    if (hit) return hit;
    note(ctx, idx, field + ' com valor não reconhecido ("' + raw + '"): ' +
      (fallback === '' ? 'o campo ficou em branco para você escolher.' : 'foi usado "' + fallback + '".'));
    return fallback;
  }

  // ------------------------------------------------------------------ elementos → estado

  function parseState(el, ctx, idx) {
    if (!el) return { state: '', stateName: '' };
    const abbr = attrOf(el, 'abbreviation').toUpperCase();
    const name = text(el);
    const st = V.STATES.find(function (s) { return s[0] === abbr; }) ||
      V.STATES.find(function (s) { return fold(s[1]) === fold(name); }) ||
      V.STATES.find(function (s) { return s[0] === name.toUpperCase(); });
    if (!st) {
      note(ctx, idx, 'State com valor não reconhecido ("' + (name || abbr) + '"): escolha o estado no formulário.');
      return { state: '', stateName: name };
    }
    return { state: st[0], stateName: name || st[1] };
  }

  function parseLocation(el, full, ctx, idx) {
    if (!el) return null;
    const st = parseState(kid(el, 'State'), ctx, idx);
    const loc = {
      country: textOf(el, 'Country'),
      countryAbbr: attrOf(kid(el, 'Country'), 'abbreviation'),
      state: st.state,
      stateName: st.stateName,
      city: textOf(el, 'City'),
      neighborhood: textOf(el, 'Neighborhood'),
      address: textOf(el, 'Address'),
      postalCode: textOf(el, 'PostalCode'),
    };
    if (full) {
      loc.displayAddress = pick(ctx, idx, 'displayAddress', attrOf(el, 'displayAddress'),
        V.DISPLAY_ADDRESS.map(function (o) { return o[0]; }), 'All');
      loc.zone = textOf(el, 'Zone');
      loc.streetNumber = textOf(el, 'StreetNumber');
      loc.complement = textOf(el, 'Complement');
      loc.latitude = textOf(el, 'Latitude');
      loc.longitude = textOf(el, 'Longitude');
    }
    return loc;
  }

  function parseContact(el, ctx, idx) {
    if (!el) return null;
    return {
      name: textOf(el, 'Name'),
      email: textOf(el, 'Email'),
      website: textOf(el, 'Website'),
      logo: textOf(el, 'Logo'),
      officeName: textOf(el, 'OfficeName'),
      telephone: textOf(el, 'Telephone'),
      location: parseLocation(kid(el, 'Location'), false, ctx, idx),
    };
  }

  function parseMedia(el, ctx, idx) {
    const items = [];
    kids(kid(el, 'Media'), 'Item').forEach(function (it) {
      const url = text(it);
      if (!url) return;
      const given = attrOf(it, 'medium');
      let medium = V.MEDIUMS.map(function (o) { return o[0]; }).find(function (v) { return v === given.toLowerCase(); });
      if (!medium) {
        medium = guessMedium(url);
        note(ctx, idx, given
          ? 'Item de mídia com medium não reconhecido ("' + given + '"): o tipo foi deduzido pela URL.'
          : 'Item de mídia sem o atributo medium: o tipo foi deduzido pela URL.');
      }
      items.push({
        medium: medium,
        url: url,
        caption: medium === 'image' ? attrOf(it, 'caption') : '',
        primary: medium === 'image' && /^(true|1)$/i.test(attrOf(it, 'primary')),
      });
    });
    return items;
  }

  function parseDetails(el, transactionType, ctx, idx) {
    const d = kid(el, 'Details');
    const sale = transactionType === 'For Sale' || transactionType === 'Sale/Rent';
    const rent = transactionType === 'For Rent' || transactionType === 'Sale/Rent';

    const listPrice = textOf(d, 'ListPrice');
    const rentalPrice = textOf(d, 'RentalPrice');
    // Com o tipo de transação em branco (não reconhecido) o aviso seria só consequência do outro.
    if (listPrice && transactionType && !sale) note(ctx, idx, 'ListPrice em imóvel que não é de venda: o valor foi mantido, mas só é enviado se o tipo de transação incluir venda.');
    if (rentalPrice && transactionType && !rent) note(ctx, idx, 'RentalPrice em imóvel que não é de aluguel: o valor foi mantido, mas só é enviado se o tipo de transação incluir aluguel.');

    // IPTU: feeds antigos só têm YearlyTax (em desuso). O valor vai para Iptu e YearlyTax continua sendo enviado.
    const yearlyEl = kid(d, 'YearlyTax');
    let iptu = textOf(d, 'Iptu');
    let iptuPeriod = pick(ctx, idx, 'Iptu period', attrOf(kid(d, 'Iptu'), 'period'),
      V.IPTU_PERIODS.map(function (o) { return o[0]; }), 'Yearly');
    if (!kid(d, 'Iptu') && yearlyEl) {
      iptu = text(yearlyEl);
      iptuPeriod = 'Yearly';
      note(ctx, idx, 'O imóvel só tem YearlyTax (campo em desuso): o valor foi copiado para Iptu (anual) e YearlyTax continua sendo enviado.');
    }

    const warrantyValues = V.WARRANTIES.map(function (o) { return o[0]; });
    const warranties = [];
    kids(kid(d, 'Warranties'), 'Warranty').forEach(function (w) {
      const v = pick(ctx, idx, 'Warranty', text(w), warrantyValues, '');
      if (v && warranties.indexOf(v) < 0) warranties.push(v);
    });

    const features = [];
    kids(kid(d, 'Features'), 'Feature').forEach(function (f) {
      const v = text(f);
      if (v && features.indexOf(v) < 0) features.push(v);
    });

    const garage = kid(d, 'Garage');
    if (garage) ctx.garage[attrOf(garage, 'type') ? 'withType' : 'withoutType']++;

    return {
      usageType: pick(ctx, idx, 'UsageType', textOf(d, 'UsageType'), V.USAGE_TYPES.map(function (o) { return o[0]; }), ''),
      propertyType: pick(ctx, idx, 'PropertyType', textOf(d, 'PropertyType'),
        V.PROPERTY_TYPES.map(function (p) { return p.value; }), ''),
      description: textOf(d, 'Description'),
      listPrice: listPrice,
      rentalPrice: rentalPrice,
      rentalPeriod: pick(ctx, idx, 'RentalPrice period', attrOf(kid(d, 'RentalPrice'), 'period'),
        V.RENTAL_PERIODS.map(function (o) { return o[0]; }), 'Monthly'),
      adminFee: textOf(d, 'PropertyAdministrationFee'),
      iptu: iptu,
      iptuPeriod: iptuPeriod,
      sendYearlyTax: !!yearlyEl,
      livingArea: textOf(d, 'LivingArea'),
      lotArea: textOf(d, 'LotArea'),
      bedrooms: textOf(d, 'Bedrooms'),
      bathrooms: textOf(d, 'Bathrooms'),
      suites: textOf(d, 'Suites'),
      garage: text(garage),
      floors: textOf(d, 'Floors'),
      unitFloor: textOf(d, 'UnitFloor'),
      buildings: textOf(d, 'Buildings'),
      yearBuilt: textOf(d, 'YearBuilt'),
      features: features,
      warranties: warranties,
    };
  }

  function parseListing(el, idx, ctx) {
    const transactionType = pick(ctx, idx, 'TransactionType', textOf(el, 'TransactionType'),
      V.TRANSACTION_TYPES.map(function (o) { return o[0]; }), '');
    return {
      listingId: textOf(el, 'ListingID'),
      title: textOf(el, 'Title'),
      transactionType: transactionType,
      publicationType: pick(ctx, idx, 'PublicationType', textOf(el, 'PublicationType'),
        V.PUBLICATION_TYPES.map(function (o) { return o[0]; }), ''),
      detailViewUrl: textOf(el, 'DetailViewUrl'),
      virtualTourLink: textOf(el, 'VirtualTourLink'),
      media: parseMedia(el, ctx, idx),
      details: parseDetails(el, transactionType, ctx, idx),
      location: parseLocation(kid(el, 'Location'), true, ctx, idx) || {
        country: '', countryAbbr: '', state: '', stateName: '', city: '', neighborhood: '', address: '', postalCode: '',
        displayAddress: 'All', zone: '', streetNumber: '', complement: '', latitude: '', longitude: '',
      },
    };
  }

  /*
   * O formulário tem um contato da imobiliária e, opcionalmente, um por imóvel.
   * O contato mais frequente no arquivo vira o da imobiliária; os imóveis com
   * um contato diferente ficam com o próprio.
   */
  function consolidateContacts(listings, contacts) {
    const counts = {};
    contacts.forEach(function (c) {
      if (c) {
        const k = JSON.stringify(c);
        counts[k] = (counts[k] || 0) + 1;
      }
    });
    const keys = Object.keys(counts);
    if (!keys.length) {
      listings.forEach(function (l) { l.contact = null; });
      return { contact: null, own: 0 };
    }
    const best = keys.reduce(function (a, b) { return counts[b] > counts[a] ? b : a; });
    let own = 0;
    listings.forEach(function (l, i) {
      const c = contacts[i];
      if (c && JSON.stringify(c) !== best) {
        l.contact = Object.assign({ useOwn: true }, c);
        own++;
      } else {
        l.contact = null; // usa o contato da imobiliária
      }
    });
    return { contact: JSON.parse(best), own: own };
  }

  // O app guarda a descrição com Enter de verdade e converte para <br> ao gerar (opção "Enter vira <br>").
  const BR_TOKEN = /&lt;br\s*\/?&gt;\r?\n?/gi;

  function detectSettings(raw, encoding, ctx, listings) {
    const settings = { encoding: encoding };

    const textTags = /<(City|Neighborhood|Address|Name|OfficeName|Provider|ContactName)\b[^>]*>(\s*<!\[CDATA\[)?/g;
    let total = 0;
    let withCdata = 0;
    let m;
    while ((m = textTags.exec(raw))) { total++; if (m[2]) withCdata++; }
    if (total) settings.useCdata = withCdata * 2 >= total;

    const usesBr = listings.some(function (l) { return /&lt;br\s*\/?&gt;/i.test(l.details.description); });
    if (usesBr) {
      settings.newlinesToBr = true;
      listings.forEach(function (l) { l.details.description = l.details.description.replace(BR_TOKEN, '\n').trim(); });
    } else if (listings.some(function (l) { return /\n/.test(l.details.description); })) {
      settings.newlinesToBr = false;
    }

    if (ctx.garage.withType + ctx.garage.withoutType) settings.garageTypeAttr = ctx.garage.withType >= ctx.garage.withoutType;
    return settings;
  }

  // ------------------------------------------------------------------ XML

  function parseXml(raw) {
    let xml = raw.replace(/^﻿/, '');
    if (!/^\s*</.test(xml)) throw ImportError('not-xml', 'O link não devolveu um XML.', 'Confira se é o link direto do arquivo .xml.');
    if (/^\s*(<!doctype\s+html|<html)/i.test(xml)) {
      throw ImportError('not-xml', 'O link abriu uma página da web (HTML), não um arquivo XML.', 'Use o link direto do arquivo .xml.');
    }
    // O texto já foi decodificado; a declaração de encoding só atrapalharia o parser.
    xml = xml.replace(/^(\s*<\?xml[^?]*?)\sencoding\s*=\s*(["'])[^"']*\2/i, '$1');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const bad = doc.getElementsByTagName('parsererror')[0];
    if (bad) {
      // Chrome: "error on line 1 at column 62: …"; Firefox: "XML Parse Error: …".
      const found = String(bad.textContent).match(/error on line \d+ at column \d+:[^\n]*|XML Parse Error:[^\n]*/i);
      throw ImportError('not-xml', 'O arquivo não é um XML válido.' + (found ? ' (' + found[0].trim().slice(0, 160) + ')' : ''));
    }
    return doc;
  }

  /*
   * Lê um XML VRSync (texto já decodificado) e devolve
   * { project, report }: o estado do projeto e um relatório do que foi lido.
   */
  function parseFeed(raw, meta) {
    meta = meta || {};
    const doc = parseXml(raw);
    const root = doc.documentElement;
    if (nameOf(root) !== 'ListingDataFeed') {
      throw ImportError('not-vrsync', 'Este XML não é um feed VRSync (elemento raiz "' + nameOf(root) + '"; o esperado é "ListingDataFeed").',
        'Só o formato VRSync é aceito. O formato ZAP antigo e outros formatos não são lidos.');
    }
    const listingEls = kids(kid(root, 'Listings'), 'Listing');
    if (!listingEls.length) throw ImportError('empty', 'O XML não tem nenhum imóvel (Listing).');

    const ctx = { notes: {}, garage: { withType: 0, withoutType: 0 } };
    const ignored = {};
    findIgnored(root, SCHEMA, nameOf(root), ignored);

    const contacts = [];
    const listings = listingEls.map(function (el, i) {
      contacts.push(parseContact(kid(el, 'ContactInfo'), ctx, i));
      return parseListing(el, i, ctx);
    });

    const headerEl = kid(root, 'Header');
    const header = {
      provider: textOf(headerEl, 'Provider'),
      email: textOf(headerEl, 'Email'),
      contactName: textOf(headerEl, 'ContactName'),
      telephone: textOf(headerEl, 'Telephone'),
      publishDate: dateTimeLocal(textOf(headerEl, 'PublishDate')),
      // Ao gerar de novo, a data de publicação do arquivo deve ser a de agora.
      autoDate: true,
    };

    const consolidated = consolidateContacts(listings, contacts);
    const settings = detectSettings(raw, meta.encoding || 'UTF-8', ctx, listings);

    const notes = Object.keys(ctx.notes).map(function (k) {
      return { message: ctx.notes[k].message, count: ctx.notes[k].listings.length };
    }).sort(function (a, b) { return b.count - a.count; });
    if (raw.indexOf('�') >= 0) {
      notes.unshift({
        message: 'O arquivo tem caracteres inválidos (�): o encoding declarado no XML provavelmente não é o real. Confira os acentos.',
        count: 0,
      });
    }

    return {
      project: { settings: settings, header: header, contact: consolidated.contact, listings: listings, current: 0 },
      report: {
        listings: listings.length,
        encoding: settings.encoding,
        ownContacts: consolidated.own,
        notes: notes,
        ignored: Object.keys(ignored).map(function (p) { return { path: p, count: ignored[p] }; })
          .sort(function (a, b) { return b.count - a.count; }),
      },
    };
  }

  // ------------------------------------------------------------------ download

  function encodingName(label) {
    return /8859-?1\b|latin-?1|1252/i.test(label) ? 'ISO8859-1' : 'UTF-8';
  }

  // Lê o encoding declarado no XML (ou o BOM) e decodifica; response.text() assumiria sempre UTF-8.
  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    let label = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
    else if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
      const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 300));
      const m = head.match(/^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([^"']+)["']/i);
      if (m) label = m[1].trim();
    }
    let txt;
    try {
      txt = new TextDecoder(label).decode(bytes);
    } catch (e) {
      label = 'utf-8';
      txt = new TextDecoder('utf-8').decode(bytes);
    }
    return { text: txt, encoding: encodingName(label) };
  }

  function parseHttpUrl(raw, what) {
    const v = String(raw || '').trim();
    if (!v) throw ImportError('invalid-url', what === 'proxy' ? 'Informe o endereço do proxy.' : 'Cole o link do XML.');
    let u = null;
    try { u = new URL(v); } catch (e) { /* tratado abaixo */ }
    if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
      throw ImportError('invalid-url', (what === 'proxy' ? 'O endereço do proxy' : 'O link') + ' não é válido. Ele deve começar com http:// ou https://.');
    }
    return u;
  }

  function proxyTarget(template, url) {
    if (template.indexOf('{url}') < 0) {
      throw ImportError('invalid-proxy', 'O endereço do proxy precisa ter {url} no lugar onde o link do XML entra.');
    }
    return parseHttpUrl(template.replace('{url}', encodeURIComponent(url.href)), 'proxy').href;
  }

  function httpMessage(status) {
    if (status === 404 || status === 410) return 'O servidor não encontrou o arquivo (erro ' + status + '). Confira o link.';
    if (status === 401 || status === 403) return 'O servidor recusou o acesso (erro ' + status + '). O link precisa ser público.';
    return 'O servidor respondeu com erro ' + status + '.';
  }

  async function download(target) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    try {
      const res = await fetch(target, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      if (!res.ok) throw ImportError('http', httpMessage(res.status));
      return await res.arrayBuffer();
    } catch (e) {
      if (e && e.name === 'ImportError') throw e;
      if (e && e.name === 'AbortError') throw ImportError('timeout', 'O servidor demorou mais de ' + TIMEOUT_MS / 1000 + ' segundos para responder.');
      throw ImportError('network', 'Não foi possível baixar o arquivo.');
    } finally {
      clearTimeout(timer);
    }
  }

  function networkHint(url, hasProxy) {
    let hint = 'O mais provável é que o servidor do XML não permita a leitura por outros sites (bloqueio CORS). ' +
      'Também pode ser link fora do ar, falta de conexão';
    if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol === 'http:') {
      hint += ' ou o fato de o link ser http:// e esta página ser https:// (o navegador bloqueia)';
    }
    hint += '.';
    if (!hasProxy) hint += ' Se for CORS, informe um proxy em "O servidor bloqueou o acesso?", logo abaixo.';
    return hint;
  }

  /*
   * Baixa o XML do link e o converte. Se o acesso direto falhar por rede/CORS e
   * houver um proxy configurado (modelo com {url}), tenta de novo por ele.
   * options: { proxy, onStatus(msg) }
   */
  async function loadFromUrl(rawUrl, options) {
    options = options || {};
    const url = parseHttpUrl(rawUrl);
    const proxy = options.proxy ? proxyTarget(String(options.proxy).trim(), url) : null;

    let buffer;
    let via = 'direct';
    try {
      buffer = await download(url.href);
    } catch (e) {
      if (e.code !== 'network') throw e;
      if (!proxy) {
        e.hint = networkHint(url, false);
        throw e;
      }
      if (options.onStatus) options.onStatus('O acesso direto foi bloqueado. Tentando pelo proxy configurado…');
      try {
        buffer = await download(proxy);
      } catch (e2) {
        if (e2.code === 'network') e2.hint = networkHint(url, true) + ' O proxy configurado também não respondeu.';
        throw e2;
      }
      via = 'proxy';
    }

    const decoded = decode(buffer);
    const result = parseFeed(decoded.text, { encoding: decoded.encoding });
    result.report.via = via;
    result.report.url = url.href;
    return result;
  }

  return { loadFromUrl, parseFeed, decode, guessMedium };
})();
