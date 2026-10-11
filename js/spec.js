/*
 * Especificação VRSync (Grupo OLX / ZAP / VivaReal / Canal Pro)
 * Fonte: https://developers.grupozap.com/feeds/vrsync/
 *
 * Todos os valores aceitos e regras citados na documentação ficam concentrados
 * aqui, para que o formulário, o gerador e o validador usem a mesma fonte.
 */
window.VRSYNC = (function () {
  'use strict';

  const NAMESPACE = 'http://www.vivareal.com/schemas/1.0/VRSync';
  const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
  const SCHEMA_LOCATION = 'http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd';

  // Página "Encoding XML": somente ISO8859-1 ou UTF-8 são suportados.
  const ENCODINGS = [
    ['UTF-8', 'UTF-8'],
    ['ISO8859-1', 'ISO8859-1 (Latin-1)'],
  ];

  // Página "Regras de Integração": até 50 mil anúncios por arquivo.
  const MAX_LISTINGS = 50000;

  // Listing > TransactionType
  const TRANSACTION_TYPES = [
    ['For Sale', 'Venda'],
    ['For Rent', 'Aluguel'],
    ['Sale/Rent', 'Venda e Aluguel'],
  ];

  // Listing > PublicationType
  const PUBLICATION_TYPES = [
    ['STANDARD', 'Padrão'],
    ['PREMIUM', 'Destaque Padrão'],
    ['SUPER_PREMIUM', 'Super destaque'],
    ['PREMIERE_1', 'Destaque Exclusivo* (somente contratos Zap+)'],
    ['PREMIERE_2', 'Destaque Superior* (somente contratos Zap+)'],
    ['TRIPLE', 'Destaque Triplo*'],
  ];

  // Listing > Location@displayAddress
  const DISPLAY_ADDRESS = [
    ['All', 'Endereço completo (logradouro e número)'],
    ['Street', 'Somente o logradouro (sem número)'],
    ['Neighborhood', 'Somente o bairro'],
  ];

  // Listing > Media > Item@medium
  const MEDIUMS = [
    ['image', 'Foto (image)'],
    ['video', 'Vídeo do YouTube (video)'],
    ['reel', 'Vídeo curto vertical (reel)'],
  ];

  // Details > UsageType
  const USAGE_TYPES = [
    ['Residential', 'Residencial'],
    ['Commercial', 'Comercial'],
    ['Residential / Commercial', 'Residencial e/ou Comercial'],
  ];

  // Details > RentalPrice@period (sem period, o portal assume mensal)
  const RENTAL_PERIODS = [
    ['Monthly', 'Mensal (padrão)'],
    ['Daily', 'Diário'],
    ['Weekly', 'Semanal'],
    ['Quarterly', 'Trimestral'],
    ['Yearly', 'Anual'],
  ];

  // Details > Iptu@period (sem period, o portal assume anual)
  const IPTU_PERIODS = [
    ['Yearly', 'Anual (padrão)'],
    ['Monthly', 'Mensal'],
  ];

  // Details > Warranties > Warranty
  const WARRANTIES = [
    ['SECURITY_DEPOSIT', 'Depósito de segurança (caução)'],
    ['GUARANTOR', 'Fiador'],
    ['INSURANCE_GUARANTEE', 'Garantia de seguro (seguro fiança)'],
    ['GUARANTEE_LETTER', 'Carta de garantia'],
    ['CAPITALIZATION_BONDS', 'Títulos de capitalização'],
  ];

  /*
   * Details > PropertyType
   * value: valor do elemento | vivareal / zap: nome do filtro em cada portal
   * area: área que a documentação manda informar (LotArea para terrenos,
   *       galpões, fazendas/sítios e chácaras; LivingArea para os demais)
   * bathrooms / bedrooms: obrigatoriedade conforme as tabelas "Legenda"
   * complement: tipos em que a documentação recomenda informar o complemento
   */
  const PROPERTY_TYPES = [
    { value: 'Residential / Apartment', vivareal: 'Apartamento', zap: 'Apartamento', area: 'LivingArea', bathrooms: true, bedrooms: true, complement: true },
    { value: 'Residential / Home', vivareal: 'Casa', zap: 'Casa', area: 'LivingArea', bathrooms: true, bedrooms: true },
    { value: 'Residential / Condo', vivareal: 'Casa de Condomínio', zap: 'Casa de Condomínio', area: 'LivingArea', bathrooms: true, bedrooms: true, complement: true },
    { value: 'Residential / Village House', vivareal: '-', zap: 'Casa de Vila', area: 'LivingArea', bathrooms: true, bedrooms: true },
    { value: 'Residential / Farm Ranch', vivareal: 'Chácara', zap: '-', area: 'LotArea', bathrooms: true, bedrooms: true },
    { value: 'Residential / Penthouse', vivareal: 'Cobertura', zap: 'Cobertura', area: 'LivingArea', bathrooms: true, bedrooms: true, complement: true },
    { value: 'Commercial / Consultorio', vivareal: 'Consultório', zap: '-', area: 'LivingArea', bathrooms: true, bedrooms: false },
    { value: 'Commercial / Edificio Residencial', vivareal: 'Edifício Residencial', zap: '-', area: 'LivingArea', bathrooms: true, bedrooms: true },
    { value: 'Residential / Agricultural', vivareal: 'Fazenda/Sítios/Chácaras', zap: 'Fazenda / Sítio / Chácara', area: 'LotArea', bathrooms: true, bedrooms: true },
    { value: 'Residential / Flat', vivareal: 'Flat', zap: 'Flat', area: 'LivingArea', bathrooms: true, bedrooms: true, complement: true },
    { value: 'Commercial / Industrial', vivareal: 'Galpão/Depósito/Armazém', zap: 'Galpão / Depósito / Armazém', area: 'LotArea', bathrooms: false, bedrooms: false },
    { value: 'Commercial / Garage', vivareal: '-', zap: 'Garagem', area: 'LivingArea', bathrooms: false, bedrooms: false },
    { value: 'Commercial / Hotel', vivareal: 'Hotel/Motel/Pousada', zap: 'Hotel / Motel / Pousada', area: 'LivingArea', bathrooms: false, bedrooms: false },
    { value: 'Commercial / Building', vivareal: 'Imóvel Comercial', zap: '-', area: 'LivingArea', bathrooms: false, bedrooms: false },
    { value: 'Residential / Kitnet', vivareal: 'Kitnet/Conjugado', zap: 'Kitnet', area: 'LivingArea', bathrooms: true, bedrooms: true, complement: true, bedroomsFixedZero: true },
    { value: 'Residential / Studio', vivareal: 'Apartamento', zap: 'Studio', area: 'LivingArea', bathrooms: false, bedrooms: true },
    { value: 'Residential / Loft', vivareal: 'Apartamento', zap: 'Loft', area: 'LivingArea', bathrooms: true, bedrooms: true, complement: true },
    { value: 'Commercial / Corporate Floor', vivareal: '-', zap: 'Andar / Laje Corporativa', area: 'LivingArea', bathrooms: false, bedrooms: false },
    { value: 'Residential / Land Lot', vivareal: 'Lote/Terreno', zap: 'Terreno / Lote / Condomínio', area: 'LotArea', bathrooms: false, bedrooms: false },
    { value: 'Commercial / Land Lot', vivareal: 'Lote/Terreno', zap: 'Terreno / Lote / Condomínio', area: 'LotArea', bathrooms: false, bedrooms: false },
    { value: 'Commercial / Business', vivareal: 'Ponto Comercial/Loja/Box', zap: 'Loja / Salão / Ponto Comercial', area: 'LivingArea', bathrooms: false, bedrooms: false },
    { value: 'Commercial / Edificio Comercial', vivareal: 'Prédio/Edifício Inteiro', zap: 'Prédio Inteiro', area: 'LivingArea', bathrooms: false, bedrooms: false },
    { value: 'Commercial / Office', vivareal: 'Sala/Conjunto', zap: 'Conjunto Comercial / Sala', area: 'LivingArea', bathrooms: true, bedrooms: false },
    { value: 'Residential / Sobrado', vivareal: 'Sobrado', zap: '-', area: 'LivingArea', bathrooms: true, bedrooms: true },
    // Os dois tipos abaixo não aparecem na tabela de PropertyType, apenas nas
    // tabelas de obrigatoriedade de Bathrooms/Bedrooms da documentação.
    { value: 'Commercial / Loja', vivareal: '-', zap: '-', area: 'LivingArea', bathrooms: true, bedrooms: false, onlyInRequirementTables: true },
    { value: 'Commercial / Studio', vivareal: '-', zap: '-', area: 'LivingArea', bathrooms: false, bedrooms: true, onlyInRequirementTables: true },
  ];

  // Details > Features > Feature (tabela "Valores a serem enviados no elemento Features")
  const FEATURES = [
    ["Administration", "Administração"],
    ["Alarm System", "Sistema de alarme"],
    ["Armored Security Cabin", "Guarita blindada"],
    ["Backyard", "Quintal"],
    ["Balcony", "Varanda"],
    ["Bathtub", "Banheira"],
    ["Bar", "Bar"],
    ["Barbecue Balcony", "Churrasqueira na varanda"],
    ["BBQ", "Churrasqueira"],
    ["Beauty Room", "Espaço de beleza"],
    ["Bicycles Place", "Bicicletário"],
    ["Builtin Wardrobe", "Armário embutido"],
    ["Caretaker", "Zelador"],
    ["Caretaker House", "Casa de caseiro"],
    ["Cable Television", "TV a cabo"],
    ["Closet", "Closet"],
    ["Controlled Access", "Vigia"],
    ["Cooling", "Ar condicionado"],
    ["Copa", "Copa"],
    ["Digital Locker", "Fechadura digital"],
    ["Dinner Room", "Sala de jantar"],
    ["Eco Condominium", "Condomínio sustentável"],
    ["Eco Garbage Collector", "Coleta seletiva de lixo"],
    ["Edicule", "Edícula"],
    ["Electric Charger", "Carregador eletrônico para carro e bicicleta"],
    ["Elevator", "Elevador"],
    ["Fenced Yard", "Condomínio fechado"],
    ["Fireplace", "Lareira"],
    ["Fitness Room", "Espaço fitness"],
    ["Furnished", "Mobiliado"],
    ["Game room", "Salão de jogos"],
    ["Garden Area", "Jardim"],
    ["Geminada", "Geminada"],
    ["Generator", "Gerador elétrico"],
    ["Gourmet Area", "Espaço gourmet"],
    ["Gourmet Balcony", "Varanda gourmet"],
    ["Gourmet Kitchen", "Cozinha Gourmet"],
    ["Gravel", "Cascalho"],
    ["Green space / Park", "Espaço verde / Parque"],
    ["Gym", "Academia"],
    ["Heating", "Aquecimento"],
    ["Home Office", "Escritório"],
    ["Indoor Soccer", "Quadra de futebol"],
    ["Integrated Environments", "Ambientes integrados"],
    ["Intercom", "Interfone"],
    ["Internet Connection", "Conexão à internet"],
    ["Jogging track", "Pista de cooper"],
    ["Kitchen", "Cozinha"],
    ["Kitchen Cabinets", "Armário na cozinha"],
    ["Lake View", "Vista para lago"],
    ["Land", "Terra"],
    ["Large Kitchen", "Cozinha grande"],
    ["Large Window", "Janela grande"],
    ["Laundry", "Lavanderia"],
    ["Lawn", "Gramado"],
    ["Lunch Room", "Sala de almoço"],
    ["Maid's Quarters", "Área de serviço"],
    ["Media Room", "Cinema"],
    ["Meeting Room", "Sala de reunião"],
    ["Mezzanine", "Mezanino"],
    ["Mountain View", "Vista para a montanha"],
    ["Ocean View", "Vista para o mar"],
    ["Party Room", "Salão de Festas"],
    ["Patrol", "Ronda/Vigilância"],
    ["Paved Street", "Rua asfaltada"],
    ["Pay-per-use Services", "Serviço pay per use"],
    ["Pets Allowed", "Permite animais"],
    ["Pet Space", "Espaço Pet"],
    ["Playground", "Playground"],
    ["Pool", "Piscina"],
    ["Reception room", "Recepção"],
    ["Recreation Area", "Área de lazer"],
    ["Reflective Pool", "Espelhos d'água"],
    ["Sand Pit", "Quadra de areia"],
    ["Sauna", "Sauna"],
    ["Semi Olympic Pool", "Piscina semi-olímpica"],
    ["Smart Apartment", "Apartamento inteligente"],
    ["Smart Condominium", "Condomínio inteligente"],
    ["Solar Energy", "Energia solar"],
    ["Spa", "Spa"],
    ["Sports Court", "Quadra poliesportiva"],
    ["Square", "Praça"],
    ["Squash", "Quadra de squash"],
    ["Stair", "Escada"],
    ["Stores", "Loja"],
    ["Tennis court", "Quadra de tênis"],
    ["TV Security", "Circuito de segurança"],
    ["Valet Parking", "Manobrista"],
    ["Warehouse", "Depósito"],
    ["Water Tank", "Reservatório de água"],
    ["American Kitchen", "Cozinha americana"],
    ["Full Floor", "Andar inteiro"],
    ["Aquarium", "Aquário"],
    ["Bedroom Wardrobe", "Armário embutido no quarto"],
    ["Bathroom Cabinets", "Armário no banheiro"],
    ["Service Bathroom", "Banheiro de serviço"],
    ["Blindex Box", "Box blindex"],
    ["Carpet", "Capete"],
    ["Background House", "Casa de fundo"],
    ["Headquarters", "Casa sede"],
    ["Gas Shower", "Chuveiro a gás"],
    ["Burn Cement", "Cimento queimado"],
    ["Employee Dependency", "Dependência de empregados"],
    ["Pantry", "Despensa"],
    ["Drywall", "Drywall"],
    ["Cooker", "Fogão"],
    ["Pizza Oven", "Forno de pizza"],
    ["Freezer", "Freezer"],
    ["Sanca", "Gesso - Sanca - Teto Rebaixado"],
    ["Whirlpool", "Hidromassagem"],
    ["Corner Property", "Imóvel de esquina"],
    ["Soundproofing", "Isolamento acústico"],
    ["Thermal Insulation", "Isolamento térmico"],
    ["Aluminium Window", "Janela de alumínio"],
    ["Slab", "Laje"],
    ["Lavabo", "Lavabo"],
    ["Half Floor", "Meio andar"],
    ["Planned Furniture", "Móvel planejado"],
    ["Glass Wall", "Muro de vidro"],
    ["Walls Grids", "Muro e grade"],
    ["Hot Tub", "Ofurô"],
    ["High Ceiling Height", "Pé direito alto"],
    ["Private Pool", "Piscina privativa"],
    ["Wood Floor", "Piso de madeira"],
    ["Raised Floor", "Piso elevado"],
    ["Cold Floor", "Piso frio"],
    ["Laminated Floor", "Piso laminado"],
    ["Vinyl Floor", "Piso vinílico"],
    ["Platibanda", "Platibanda"],
    ["Porcelain", "Porcelanato"],
    ["Dividers", "Possui divisória"],
    ["Service Room", "Quarto de serviço"],
    ["Reversible Room", "Quarto extra reversível"],
    ["Large Room", "Sala grande"],
    ["Small Room", "Sala pequena"],
    ["Wall Balcony", "Varanda fechada com vidro"],
    ["Natural Ventilation", "Ventilação natural"],
    ["Panoramic View", "Vista panorâmica"],
    ["Disabled Access", "Acesso para deficientes"],
    ["Coworking", "Coworking"],
    ["Electronic Gate", "Portão eletrônico"],
    ["Fruit Trees", "Árvore frutífera"],
    ["Tree Climbing", "Arvorismo"],
    ["Library", "Biblioteca"],
    ["Toys Place", "Brinquedoteca"],
    ["Security Camera", "Câmera de segurança"],
    ["Dog Kennel", "Canil"],
    ["Barn", "Celeiro"],
    ["Beauty Center", "Centro de estética"],
    ["Fence", "Cerca"],
    ["Children Care", "Children care"],
    ["Coverage", "Cobertura coletiva"],
    ["Corral", "Curral"],
    ["Deck", "Deck"],
    ["Service Entrance", "Entrada de serviço"],
    ["Side Entrance", "Entrada lateral"],
    ["Entrance Hall", "Hall de entrada"],
    ["Vegetable Garden", "Horta"],
    ["Lake", "Lago"],
    ["Marina", "Marina"],
    ["Climbing Wall", "Muro de escalada"],
    ["Orchid Place", "Orquidário"],
    ["Redario", "Redario"],
    ["Restaurant", "Restaurante"],
    ["River", "Rio"],
    ["Convention Hall", "Salão de convenção"],
    ["Solarium", "Solarium"],
    ["Pasture", "Pasto"],
    ["Heated Pool", "Piscina aquecida"],
    ["Covered Pool", "Piscina coberta"],
    ["Skate Lane", "Pista de skate"],
    ["Well", "Poço"],
    ["Artesian Well", "Poço artesiano"],
    ["Pomar", "Pomar"],
    ["Zen Space", "Espaço zen"],
    ["Football Field", "Campo de futebol"],
    ["Golf Field", "Campo de golfe"],
    ["Helipad", "Heliponto"],
    ["Pool Bar", "Bar na piscina"],
    ["Coffee Shop", "Coffee shop"],
    ["Dress Room2", "Vestiário para diaristas"],
    ["Guest Parking", "Estacionamento para visitante"],
    ["Adult Pool", "Piscina para adulto"],
    ["Childrens Pool", "Piscina infantil"],
    ["Concierge 24h", "Portaria 24h"],
    ["Teen Space", "Espaço teen"],
  ];

  // Valores de Feature que aparecem nos exemplos completos da documentação,
  // mas não constam na tabela oficial de Features.
  const FEATURES_FROM_EXAMPLES = [
    ['Band Practice Room', 'Sala de ensaio'],
    ['Close to hospitals', 'Próximo a hospitais'],
    ['Close to main roads/avenues', 'Próximo a vias principais/avenidas'],
    ['Close to public transportation', 'Próximo a transporte público'],
    ['Close to schools', 'Próximo a escolas'],
    ['Close to shopping centers', 'Próximo a shoppings'],
    ['Exterior View', 'Vista externa'],
    ['Fully Wired', 'Totalmente cabeado'],
    ['Massage Room', 'Sala de massagem'],
    ['Number of stories', 'Número de pavimentos'],
    ['Parking Garage', 'Estacionamento'],
    ['Security Guard on Duty', 'Segurança de plantão'],
    ['Utilities', 'Utilidades'],
    ['Veranda', 'Varanda (veranda)'],
  ];

  const STATES = [
    ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'],
    ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'],
    ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'],
    ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
    ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
    ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
    ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
  ];

  // Limites citados na documentação
  const LIMITS = {
    listingId: { min: 1, max: 50 },
    title: { min: 10, max: 100 },
    description: { min: 50, max: 3000 },
    minImages: 5,
    reelExtensions: ['mp4', 'mov'],
  };

  function propertyType(value) {
    return PROPERTY_TYPES.find(function (p) { return p.value === value; }) || null;
  }

  return {
    NAMESPACE, XSI, SCHEMA_LOCATION, ENCODINGS, MAX_LISTINGS,
    TRANSACTION_TYPES, PUBLICATION_TYPES, DISPLAY_ADDRESS, MEDIUMS,
    USAGE_TYPES, RENTAL_PERIODS, IPTU_PERIODS, WARRANTIES, PROPERTY_TYPES,
    FEATURES, FEATURES_FROM_EXAMPLES, STATES, LIMITS, propertyType,
  };
})();
