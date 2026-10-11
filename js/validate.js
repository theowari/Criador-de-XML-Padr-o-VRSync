/*
 * Validação das regras descritas na documentação VRSync.
 * Erros: o portal recusa o anúncio/arquivo. Avisos: recomendações da documentação.
 */
window.VRSyncValidate = (function () {
  'use strict';

  const V = window.VRSYNC;
  const X = window.VRSyncXml;
  const blank = X.isBlank;

  const SHORTENERS = /(^|\.)(bit\.ly|goo\.gl|tinyurl\.com|t\.co|cutt\.ly|is\.gd|ow\.ly|rebrand\.ly|buff\.ly|shorturl\.at|encurtador\.com\.br)$/i;
  const EXTERNAL_VIDEO = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vimeo\.com|facebook\.com|fb\.watch|kwai)/i;
  const HTML_TAG = /<\/?[a-z][^>]*>/i;

  function parseUrl(v) {
    try {
      const u = new URL(String(v).trim());
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch (e) {
      return null;
    }
  }

  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
  }

  function isInt(v) {
    return /^\d+$/.test(String(v).trim());
  }

  function extension(url) {
    const m = url.pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  // Texto da descrição sem as marcações de formatação aceitas (&lt;br&gt;, &lt;b&gt;, &lt;i&gt;, &bull;).
  function descriptionPlain(text) {
    return String(text || '')
      .replace(/&lt;\/?(br|b|i)\s*\/?&gt;?/gi, '')
      .replace(/&bull;/gi, '•')
      .trim();
  }

  function validate(state) {
    const issues = [];
    function add(level, listing, field, message) {
      issues.push({ level: level, listing: listing, field: field, message: message });
    }
    const err = add.bind(null, 'error');
    const warn = add.bind(null, 'warning');

    // ----- Header
    const h = state.header;
    [['provider', 'Provider (desenvolvedor do feed)'], ['email', 'Email'],
      ['contactName', 'ContactName'], ['telephone', 'Telephone']].forEach(function (f) {
      if (blank(h[f[0]])) warn(null, 'header.' + f[0], 'Header: ' + f[1] + ' não informado. A documentação pede o Header completo.');
    });
    if (!blank(h.email) && !isEmail(h.email)) err(null, 'header.email', 'Header: e-mail inválido.');
    if (!h.autoDate && blank(h.publishDate)) warn(null, 'header.publishDate', 'Header: PublishDate vazio; será usada a data/hora da geração.');

    // ----- Arquivo
    const listings = state.listings;
    if (!listings.length) err(null, null, 'Nenhum imóvel cadastrado.');
    if (listings.length > V.MAX_LISTINGS) {
      err(null, null, 'O arquivo tem ' + listings.length + ' anúncios; o limite por arquivo XML é de ' + V.MAX_LISTINGS + '.');
    }

    const seen = {};
    listings.forEach(function (l, i) {
      const id = String(l.listingId || '').trim();
      if (!id) return;
      if (seen[id] !== undefined) {
        err(i, 'listing.listingId', 'ListingID "' + id + '" duplicado (também usado no imóvel #' + (seen[id] + 1) + '). Somente um será processado.');
      } else {
        seen[id] = i;
      }
    });

    // ContactInfo da imobiliária é validado uma vez, se algum imóvel o utiliza.
    if (listings.some(function (l) { return !(l.contact && l.contact.useOwn); })) {
      validateContact(state.contact, null, 'contact.', 'ContactInfo (imobiliária)', err, warn);
    }

    listings.forEach(function (l, i) { validateListing(state, l, i, err, warn); });
    return issues;
  }

  function validateContact(c, i, base, where, err, warn) {
    if (blank(c.name)) err(i, base + 'name', where + ': Name é obrigatório.');
    if (blank(c.email)) err(i, base + 'email', where + ': Email é obrigatório.');
    else if (!isEmail(c.email)) err(i, base + 'email', where + ': e-mail inválido.');
    if (!blank(c.website) && !parseUrl(c.website)) warn(i, base + 'website', where + ': Website não é uma URL válida.');
    if (!blank(c.logo) && !parseUrl(c.logo)) warn(i, base + 'logo', where + ': Logo não é uma URL válida.');
  }

  function validateListing(state, l, i, err, warn) {
    const d = l.details;
    const loc = l.location;
    const pt = V.propertyType(d.propertyType);
    const L = V.LIMITS;

    // ListingID
    const id = String(l.listingId || '').trim();
    if (id.length < L.listingId.min || id.length > L.listingId.max) {
      err(i, 'listing.listingId', 'ListingID deve ter entre 1 e 50 caracteres.');
    }

    // Title
    const title = String(l.title || '').trim();
    if (title.length < L.title.min || title.length > L.title.max) {
      err(i, 'listing.title', 'Title deve ter entre 10 e 100 caracteres (atual: ' + title.length + ').');
    }
    if (HTML_TAG.test(title)) err(i, 'listing.title', 'Title não deve conter tags HTML.');

    // TransactionType / PublicationType
    if (blank(l.transactionType)) err(i, 'listing.transactionType', 'TransactionType não informado.');
    if (blank(l.publicationType)) warn(i, 'listing.publicationType', 'PublicationType não informado.');

    // URLs
    if (!blank(l.detailViewUrl) && !parseUrl(l.detailViewUrl)) {
      err(i, 'listing.detailViewUrl', 'DetailViewUrl não é uma URL válida.');
    }
    if (!blank(l.virtualTourLink)) {
      const u = parseUrl(l.virtualTourLink);
      if (!u) err(i, 'listing.virtualTourLink', 'VirtualTourLink não é uma URL válida.');
      else {
        if (u.protocol !== 'https:') err(i, 'listing.virtualTourLink', 'VirtualTourLink deve estar em ambiente seguro (https).');
        if (SHORTENERS.test(u.hostname)) err(i, 'listing.virtualTourLink', 'VirtualTourLink não pode ser um link encurtado.');
      }
    }

    validateMedia(l, i, err, warn);

    // Details
    if (blank(d.usageType)) warn(i, 'listing.details.usageType', 'UsageType não informado.');
    if (blank(d.propertyType)) err(i, 'listing.details.propertyType', 'PropertyType é obrigatório.');
    else if (pt && pt.onlyInRequirementTables) {
      warn(i, 'listing.details.propertyType', '"' + pt.value + '" não consta na tabela de PropertyType da documentação (aparece só nas tabelas de banheiros/quartos). Prefira um valor da tabela oficial.');
    }

    const desc = String(d.description || '').trim();
    const plain = descriptionPlain(desc);
    const sent = X.descriptionContent(desc, state.settings.newlinesToBr);
    if (!desc) err(i, 'listing.details.description', 'Description é obrigatória.');
    else {
      if (plain.length < L.description.min) err(i, 'listing.details.description', 'Description deve ter no mínimo 50 caracteres (atual: ' + plain.length + ').');
      if (sent.length > L.description.max) err(i, 'listing.details.description', 'Description deve ter no máximo 3.000 caracteres (atual, com formatação: ' + sent.length + ').');
    }
    if (HTML_TAG.test(desc)) {
      err(i, 'listing.details.description', 'Description não deve conter tags HTML. Use as formatações em entidades (&lt;br&gt;, &lt;b&gt;, &lt;i&gt;, &bull;).');
    }

    // Preços
    const tt = l.transactionType;
    const sale = tt === 'For Sale' || tt === 'Sale/Rent';
    const rent = tt === 'For Rent' || tt === 'Sale/Rent';
    function money(field, label, required) {
      const v = d[field];
      if (blank(v)) {
        if (required) err(i, 'listing.details.' + field, label + ' é obrigatório para este tipo de transação.');
        return;
      }
      if (!isInt(v)) warn(i, 'listing.details.' + field, label + ': somente o valor inteiro é enviado (casas decimais serão descartadas).');
      if (Number(v) < 0) err(i, 'listing.details.' + field, label + ' não pode ser negativo.');
    }
    if (sale) money('listPrice', 'ListPrice (valor de venda)', true);
    if (rent) money('rentalPrice', 'RentalPrice (valor do aluguel)', true);
    money('adminFee', 'PropertyAdministrationFee (condomínio)', false);
    money('iptu', 'Iptu', false);
    if (d.sendYearlyTax && blank(d.iptu)) warn(i, 'listing.details.iptu', 'YearlyTax marcado, mas o valor do IPTU está vazio.');

    // Áreas
    function area(field, label) {
      const v = d[field];
      if (blank(v)) return false;
      if (!isInt(v)) warn(i, 'listing.details.' + field, label + ': informe o valor inteiro (casas decimais serão descartadas).');
      if (Number(v) <= 0) err(i, 'listing.details.' + field, label + ' deve ser maior que zero.');
      return true;
    }
    const hasLot = area('lotArea', 'LotArea (área total)');
    const hasLiving = area('livingArea', 'LivingArea (área útil)');
    if (pt && pt.area === 'LotArea') {
      if (!hasLot) err(i, 'listing.details.lotArea', 'Para ' + pt.value + ' informe a Área Total (LotArea).');
      if (!hasLiving) warn(i, 'listing.details.livingArea', 'A documentação diz que LivingArea requer ao menos um valor; considere informá-la também.');
    } else if (!hasLiving) {
      err(i, 'listing.details.livingArea', 'Área Útil (LivingArea) é obrigatória.');
    }

    // Cômodos e números
    function count(field, label) {
      const v = d[field];
      if (blank(v)) return null;
      if (!isInt(v)) { err(i, 'listing.details.' + field, label + ' deve ser um número inteiro maior ou igual a zero.'); return null; }
      return Number(v);
    }
    const bedrooms = count('bedrooms', 'Bedrooms');
    const bathrooms = count('bathrooms', 'Bathrooms');
    const suites = count('suites', 'Suites');
    count('garage', 'Garage');
    const floors = count('floors', 'Floors');
    const unitFloor = count('unitFloor', 'UnitFloor');
    count('buildings', 'Buildings');

    if (pt) {
      if (pt.bathrooms && bathrooms === null) err(i, 'listing.details.bathrooms', 'Bathrooms é obrigatório para ' + pt.value + '.');
      if (pt.bedroomsFixedZero) {
        if (bedrooms !== null && bedrooms !== 0) err(i, 'listing.details.bedrooms', 'Para Residential / Kitnet, Bedrooms deve ser 0.');
      } else if (pt.bedrooms && bedrooms === null) {
        err(i, 'listing.details.bedrooms', 'Bedrooms é obrigatório para ' + pt.value + (pt.value === 'Residential / Studio' ? ' (valor mínimo 0).' : '.'));
      }
    }
    if (suites !== null && bedrooms !== null && suites > bedrooms) warn(i, 'listing.details.suites', 'Número de suítes maior que o de quartos.');
    if (floors !== null && unitFloor !== null && unitFloor > floors) warn(i, 'listing.details.unitFloor', 'UnitFloor (andar do imóvel) maior que Floors (andares da torre).');

    if (!blank(d.yearBuilt)) {
      const y = Number(d.yearBuilt);
      if (!/^\d{4}$/.test(String(d.yearBuilt).trim()) || y > new Date().getFullYear() + 10) {
        err(i, 'listing.details.yearBuilt', 'YearBuilt deve ser um ano com 4 dígitos.');
      }
    }

    if (!rent && (d.warranties || []).length) {
      warn(i, 'listing.details.warranties', 'Warranties só se aplicam a aluguel; não serão enviadas para venda.');
    }

    // Location
    if (blank(loc.country) || blank(loc.countryAbbr)) err(i, 'listing.location.country', 'Location: Country (e abbreviation) é obrigatório.');
    if (blank(loc.state)) err(i, 'listing.location.state', 'Location: State é obrigatório.');
    if (blank(loc.city)) err(i, 'listing.location.city', 'Location: City é obrigatório.');
    if (blank(loc.neighborhood)) err(i, 'listing.location.neighborhood', 'Location: Neighborhood (bairro) é obrigatório.');
    if (blank(loc.postalCode)) err(i, 'listing.location.postalCode', 'Location: PostalCode (CEP) é obrigatório em todos os anúncios.');
    else if (!/^\d{5}-?\d{3}$/.test(String(loc.postalCode).trim())) warn(i, 'listing.location.postalCode', 'Location: CEP fora do formato 00000-000.');
    if (blank(loc.displayAddress)) err(i, 'listing.location.displayAddress', 'Location: displayAddress não informado.');
    if (blank(loc.address)) warn(i, 'listing.location.address', 'Location: a documentação recomenda sempre enviar o endereço completo (melhor posicionamento e busca por mapa).');
    if (blank(loc.streetNumber)) warn(i, 'listing.location.streetNumber', 'Location: número (StreetNumber) não informado; em breve será obrigatório para alguns tipos.');
    if (pt && pt.complement && blank(loc.complement)) {
      warn(i, 'listing.location.complement', 'Location: para ' + pt.value + ' é recomendável informar o complemento (ex.: apto 22, bl A).');
    }
    function coord(field, label, limit) {
      const v = loc[field];
      if (blank(v)) return;
      const n = Number(String(v).trim());
      if (!Number.isFinite(n) || Math.abs(n) > limit) err(i, 'listing.location.' + field, 'Location: ' + label + ' inválida (use ponto como separador decimal).');
    }
    coord('latitude', 'Latitude', 90);
    coord('longitude', 'Longitude', 180);
    if (blank(loc.latitude) !== blank(loc.longitude)) warn(i, 'listing.location.latitude', 'Location: informe Latitude e Longitude juntas.');

    // ContactInfo próprio do imóvel
    if (l.contact && l.contact.useOwn) {
      validateContact(l.contact, i, 'listing.contact.', 'ContactInfo do imóvel', err, warn);
    }
  }

  function validateMedia(l, i, err, warn) {
    const items = (l.media || []).filter(function (m) { return !blank(m.url); });
    const f = 'listing.media';
    if (!items.length) {
      err(i, f, 'Media é obrigatório (mínimo de ' + V.LIMITS.minImages + ' imagens).');
      return;
    }
    const images = items.filter(function (m) { return m.medium === 'image'; });
    const videos = items.filter(function (m) { return m.medium === 'video'; });
    const reels = items.filter(function (m) { return m.medium === 'reel'; });
    const primaries = images.filter(function (m) { return m.primary; });

    if (images.length < V.LIMITS.minImages) err(i, f, 'Todos os anúncios devem ter no mínimo 5 imagens (atual: ' + images.length + ').');
    if (primaries.length > 1) err(i, f, 'Somente uma imagem pode ser marcada como destaque (primary).');
    if (images.length && !primaries.length) warn(i, f, 'Nenhuma imagem marcada como destaque (primary="true").');
    if (videos.length > 1) err(i, f, 'Somente um vídeo (YouTube) é recebido por imóvel.');
    if (reels.length > 1) err(i, f, 'Somente um vídeo curto vertical (reel) é recebido por imóvel.');

    const urls = {};
    items.forEach(function (m, n) {
      const label = 'Mídia #' + (n + 1) + ': ';
      if (!m.medium) { err(i, f, label + 'atributo medium é obrigatório.'); return; }
      const u = parseUrl(m.url);
      if (!u) { err(i, f, label + 'URL inválida.'); return; }
      const key = u.href;
      if (urls[key]) warn(i, f, label + 'URL repetida.');
      urls[key] = true;

      if (m.medium === 'image') {
        const ext = extension(u);
        if (ext !== 'jpg' && ext !== 'jpeg') warn(i, f, label + 'somente imagens .jpg são importadas (máx. 7 MB).');
      } else if (m.medium === 'video') {
        if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname)) err(i, f, label + 'somente vídeos armazenados no YouTube são processados.');
      } else if (m.medium === 'reel') {
        if (EXTERNAL_VIDEO.test(u.hostname)) err(i, f, label + 'o reel deve ser um arquivo de vídeo, não um link de YouTube/Instagram/TikTok.');
        else if (V.LIMITS.reelExtensions.indexOf(extension(u)) < 0) warn(i, f, label + 'o reel deve ser .mp4 ou .mov (vertical 9:16, 10 a 60 s, até 80 MB).');
      }
    });
  }

  return { validate, descriptionPlain };
})();
