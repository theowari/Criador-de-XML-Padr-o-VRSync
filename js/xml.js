/*
 * Geração do XML VRSync a partir do estado do formulário.
 * A ordem dos elementos segue os exemplos completos da documentação.
 */
window.VRSyncXml = (function () {
  'use strict';

  const V = window.VRSYNC;

  function isBlank(v) {
    return v === undefined || v === null || String(v).trim() === '';
  }

  // A documentação pede somente o valor inteiro (sem casas decimais, cifrão, ponto ou vírgula).
  function toInteger(v) {
    if (isBlank(v)) return '';
    const n = Number(String(v).trim());
    if (!Number.isFinite(n)) return String(v).trim();
    return String(Math.trunc(n));
  }

  /*
   * Em ISO8859-1 só cabem caracteres até U+00FF; os demais viram referências
   * numéricas (&#NNNN;), que não podem ficar dentro de CDATA.
   */
  function makeWriter(encoding, useCdata) {
    const latin1 = encoding === 'ISO8859-1';
    const lines = [];

    function charRef(ch) {
      return '&#' + ch.codePointAt(0) + ';';
    }

    function escape(text) {
      let out = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      if (latin1) out = out.replace(/[^\u0000-ÿ]/gu, charRef);
      return out;
    }

    function cdata(text) {
      // "]]>" encerraria a seção; divide em duas seções CDATA.
      const parts = String(text).split(']]>');
      let out = parts.map(function (p, i) {
        const piece = i < parts.length - 1 ? p + ']]' : p;
        return '<![CDATA[' + piece + ']]>';
      }).join('<![CDATA[>]]>');
      if (latin1) {
        out = out.replace(/[^\u0000-ÿ]/gu, function (ch) {
          return ']]>' + charRef(ch) + '<![CDATA[';
        });
        out = out.replace(/<!\[CDATA\[\]\]>/g, '');
      }
      return out;
    }

    function attrs(map) {
      if (!map) return '';
      return Object.keys(map)
        .filter(function (k) { return !isBlank(map[k]); })
        .map(function (k) { return ' ' + k + '="' + escape(map[k]) + '"'; })
        .join('');
    }

    function indent(level) {
      return '  '.repeat(level);
    }

    return {
      raw: function (line) { lines.push(line); },
      open: function (level, name, attributes) {
        lines.push(indent(level) + '<' + name + attrs(attributes) + '>');
      },
      close: function (level, name) {
        lines.push(indent(level) + '</' + name + '>');
      },
      // Emite o elemento somente se houver valor.
      text: function (level, name, value, options) {
        options = options || {};
        if (isBlank(value)) return false;
        const forceCdata = options.cdata === true;
        const body = (forceCdata || (useCdata && options.cdata !== false))
          ? cdata(value)
          : escape(value);
        lines.push(indent(level) + '<' + name + attrs(options.attrs) + '>' + body + '</' + name + '>');
        return true;
      },
      toString: function () { return lines.join('\n') + '\n'; },
    };
  }

  function nowIso() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function publishDate(header) {
    if (header.autoDate || isBlank(header.publishDate)) return nowIso();
    // datetime-local pode vir sem segundos (AAAA-MM-DDTHH:MM)
    const v = header.publishDate.trim();
    return /T\d{2}:\d{2}$/.test(v) ? v + ':00' : v;
  }

  // Converte Enter em <br> no formato de entidades exigido pela documentação.
  function descriptionContent(text, newlinesToBr) {
    let t = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (newlinesToBr) t = t.replace(/\n/g, '&lt;br&gt;\n');
    return t;
  }

  function effectiveContact(state, listing) {
    return listing.contact && listing.contact.useOwn ? listing.contact : state.contact;
  }

  function hasAny(obj, keys) {
    return keys.some(function (k) { return !isBlank(obj[k]); });
  }

  function writeHeader(w, header) {
    w.open(1, 'Header');
    w.text(2, 'Provider', header.provider);
    w.text(2, 'Email', header.email, { cdata: false });
    w.text(2, 'ContactName', header.contactName);
    w.text(2, 'PublishDate', publishDate(header), { cdata: false });
    w.text(2, 'Telephone', header.telephone, { cdata: false });
    w.close(1, 'Header');
  }

  function writeMedia(w, media) {
    const items = (media || []).filter(function (m) { return !isBlank(m.url); });
    if (!items.length) return;
    w.open(3, 'Media');
    items.forEach(function (m) {
      const a = { medium: m.medium };
      if (m.medium === 'image') {
        if (!isBlank(m.caption)) a.caption = m.caption;
        if (m.primary) a.primary = 'true';
      }
      w.text(4, 'Item', m.url.trim(), { attrs: a, cdata: false });
    });
    w.close(3, 'Media');
  }

  function writeDetails(w, state, l) {
    const d = l.details;
    const s = state.settings;
    const tt = l.transactionType;
    const sale = tt === 'For Sale' || tt === 'Sale/Rent';
    const rent = tt === 'For Rent' || tt === 'Sale/Rent';
    const pt = V.propertyType(d.propertyType);

    w.open(3, 'Details');
    w.text(4, 'UsageType', d.usageType, { cdata: false });
    w.text(4, 'PropertyType', d.propertyType, { cdata: false });
    w.text(4, 'Description', descriptionContent(d.description, s.newlinesToBr), { cdata: true });

    if (sale) w.text(4, 'ListPrice', toInteger(d.listPrice), { attrs: { currency: 'BRL' }, cdata: false });
    if (rent) {
      w.text(4, 'RentalPrice', toInteger(d.rentalPrice), {
        attrs: { currency: 'BRL', period: d.rentalPeriod }, cdata: false,
      });
    }

    w.text(4, 'LotArea', toInteger(d.lotArea), { attrs: { unit: 'square metres' }, cdata: false });
    w.text(4, 'LivingArea', toInteger(d.livingArea), { attrs: { unit: 'square metres' }, cdata: false });
    w.text(4, 'PropertyAdministrationFee', toInteger(d.adminFee), { attrs: { currency: 'BRL' }, cdata: false });
    w.text(4, 'Iptu', toInteger(d.iptu), { attrs: { currency: 'BRL', period: d.iptuPeriod }, cdata: false });
    if (d.sendYearlyTax) {
      // YearlyTax está em desuso; enviado apenas quando o usuário pede, com o valor anual do IPTU.
      let yearly = toInteger(d.iptu);
      if (yearly !== '' && d.iptuPeriod === 'Monthly') yearly = String(Number(yearly) * 12);
      w.text(4, 'YearlyTax', yearly, { attrs: { currency: 'BRL' }, cdata: false });
    }

    let bedrooms = toInteger(d.bedrooms);
    if (pt && pt.bedroomsFixedZero) bedrooms = '0';
    w.text(4, 'Bedrooms', bedrooms, { cdata: false });
    w.text(4, 'Bathrooms', toInteger(d.bathrooms), { cdata: false });
    w.text(4, 'Suites', toInteger(d.suites), { cdata: false });
    w.text(4, 'Garage', toInteger(d.garage), {
      attrs: s.garageTypeAttr ? { type: 'Parking Space' } : null, cdata: false,
    });
    w.text(4, 'Floors', toInteger(d.floors), { cdata: false });
    w.text(4, 'UnitFloor', toInteger(d.unitFloor), { cdata: false });
    w.text(4, 'Buildings', toInteger(d.buildings), { cdata: false });
    w.text(4, 'YearBuilt', toInteger(d.yearBuilt), { cdata: false });

    const features = d.features || [];
    if (features.length) {
      w.open(4, 'Features');
      features.forEach(function (f) { w.text(5, 'Feature', f, { cdata: false }); });
      w.close(4, 'Features');
    }

    // Garantias se aplicam somente a imóveis para aluguel.
    const warranties = d.warranties || [];
    if (rent && warranties.length) {
      w.open(4, 'Warranties');
      warranties.forEach(function (x) { w.text(5, 'Warranty', x, { cdata: false }); });
      w.close(4, 'Warranties');
    }
    w.close(3, 'Details');
  }

  function stateName(uf, fallback) {
    if (!isBlank(fallback)) return fallback;
    const s = V.STATES.find(function (x) { return x[0] === uf; });
    return s ? s[1] : uf;
  }

  function writeLocation(w, level, loc, full) {
    const attrs = full ? { displayAddress: loc.displayAddress } : null;
    w.open(level, 'Location', attrs);
    w.text(level + 1, 'Country', loc.country, { attrs: { abbreviation: loc.countryAbbr } });
    if (!isBlank(loc.state)) {
      w.text(level + 1, 'State', stateName(loc.state, loc.stateName), { attrs: { abbreviation: loc.state } });
    }
    w.text(level + 1, 'City', loc.city);
    if (full) w.text(level + 1, 'Zone', loc.zone);
    w.text(level + 1, 'Neighborhood', loc.neighborhood);
    w.text(level + 1, 'Address', loc.address);
    if (full) {
      w.text(level + 1, 'StreetNumber', loc.streetNumber);
      w.text(level + 1, 'Complement', loc.complement);
    }
    w.text(level + 1, 'PostalCode', loc.postalCode, { cdata: false });
    if (full) {
      w.text(level + 1, 'Latitude', loc.latitude, { cdata: false });
      w.text(level + 1, 'Longitude', loc.longitude, { cdata: false });
    }
    w.close(level, 'Location');
  }

  function writeContact(w, c) {
    w.open(3, 'ContactInfo');
    w.text(4, 'Name', c.name);
    w.text(4, 'Email', c.email, { cdata: false });
    w.text(4, 'Website', c.website, { cdata: false });
    w.text(4, 'Logo', c.logo, { cdata: false });
    w.text(4, 'OfficeName', c.officeName);
    w.text(4, 'Telephone', c.telephone, { cdata: false });
    const loc = c.location || {};
    if (hasAny(loc, ['state', 'city', 'neighborhood', 'address', 'postalCode'])) {
      writeLocation(w, 4, loc, false);
    }
    w.close(3, 'ContactInfo');
  }

  function writeListing(w, state, l) {
    w.open(2, 'Listing');
    w.text(3, 'ListingID', l.listingId, { cdata: false });
    w.text(3, 'Title', l.title, { cdata: true });
    w.text(3, 'TransactionType', l.transactionType, { cdata: false });
    w.text(3, 'PublicationType', l.publicationType, { cdata: false });
    w.text(3, 'DetailViewUrl', l.detailViewUrl, { cdata: false });
    w.text(3, 'VirtualTourLink', l.virtualTourLink, { cdata: false });
    writeMedia(w, l.media);
    writeDetails(w, state, l);
    writeLocation(w, 3, l.location, true);
    writeContact(w, effectiveContact(state, l));
    w.close(2, 'Listing');
  }

  function generate(state) {
    const encoding = state.settings.encoding || 'UTF-8';
    const w = makeWriter(encoding, state.settings.useCdata);
    w.raw('<?xml version="1.0" encoding="' + encoding + '"?>');
    w.raw('<ListingDataFeed xmlns="' + V.NAMESPACE + '"');
    w.raw('                 xmlns:xsi="' + V.XSI + '"');
    w.raw('                 xsi:schemaLocation="' + V.SCHEMA_LOCATION + '">');
    writeHeader(w, state.header);
    w.open(1, 'Listings');
    state.listings.forEach(function (l) { writeListing(w, state, l); });
    w.close(1, 'Listings');
    w.raw('</ListingDataFeed>');
    return w.toString();
  }

  // Bytes do arquivo no encoding declarado no cabeçalho.
  function encode(xml, encoding) {
    if (encoding === 'ISO8859-1') {
      const bytes = new Uint8Array(xml.length);
      for (let i = 0; i < xml.length; i++) {
        const c = xml.charCodeAt(i);
        bytes[i] = c <= 0xff ? c : 0x3f; // '?' (não deve ocorrer: o writer já converte)
      }
      return bytes;
    }
    return new TextEncoder().encode(xml);
  }

  return {
    generate, encode, isBlank, toInteger, descriptionContent, effectiveContact,
  };
})();
