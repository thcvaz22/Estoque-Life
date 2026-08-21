/* ============================================================
   PRESEED V18.1 — vendedores e carteiras iniciais
   Fonte: relatórios "último pedido cliente por vendedor"
   emitidos em 20/08/2026 e enviados para homologação.

   Segurança:
   - a senha padrão não é armazenada em texto puro;
   - cada vendedor possui salt + scrypt hash próprios;
   - o seed SOMENTE cria contas ausentes; nunca redefine senha
     de conta já existente.
   ============================================================ */

const SELLERS = [
  {
    "id": "user_seller_fabiana",
    "username": "fabiana",
    "nome": "FABIANA",
    "passwordSalt": "689755e30dd0e6b14bc2f8756f0518c9",
    "passwordHash": "2f63fea6048d40810dcadc24d1d542cc94e7367d92aa2e0456e3cba20183fc710134a6c03b61afc37077dc88a701954a905652cabfaaf5da4913d179dca8027b"
  },
  {
    "id": "user_seller_fabiano_pelanda",
    "username": "fabiano.pelanda",
    "nome": "FABIANO PELANDA",
    "passwordSalt": "eaa41e424f457368588aaf6095404c08",
    "passwordHash": "032125df3d6e8746f7b5ef248acb9e26b8ea23beb061841b09324e198f922a3a02014f5602b49ad901601897dbbbb0da4df512147f474da315b63820fe33e74a"
  },
  {
    "id": "user_seller_manoel_jr",
    "username": "manoel.jr",
    "nome": "MANOEL JR",
    "passwordSalt": "c1ea49032b7d49bfcaf06a094df39441",
    "passwordHash": "5953c15de4532fc68abc63e3a53f6b14219500f49b54cddac1fc1f1790d27059a188a951f6aca3c018d33b5badfcb24ef6e355128fe13e3ca7065957dd87cd4a"
  },
  {
    "id": "user_seller_marcos_schultz",
    "username": "marcos.schultz",
    "nome": "MARCOS SCHULTZ",
    "passwordSalt": "cfc87c37f35c2107c0a91765cb989455",
    "passwordHash": "693cf087e11922bedf5f1a5f167e642262c88bf567b95f6bbfa87af501c7156389c9384035c8a1f3cccf61f94f7f9f7adae9d139d100e63382954c0e581ede4e"
  },
  {
    "id": "user_seller_antonio_alves",
    "username": "antonio.alves.da.silva",
    "nome": "ANTONIO ALVES DA SILVA",
    "passwordSalt": "eb7c62c47c81de47ada0db16ef274319",
    "passwordHash": "89bef7f060d53b02daa7d47d494eeaba06adb7f99b2142a28c675fad1927f38d213c1f457ef2077d2408ce4197b47fcae405223aea82dc671baa955371fe56dc"
  }
];

const CUSTOMER_PORTFOLIOS = [
  {
    "sellerName": "FABIANA",
    "sellerUsername": "fabiana",
    "customers": [
      {
        "nome": "PANIFIVIP PANIFICADORA E CONFEITARIA",
        "ultimaCompra": "2026-02-11"
      },
      {
        "nome": "PANIFICADORA DOIS IRMAOS",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "PANIFICADORA E CONFEITARIA MAGALHAES",
        "ultimaCompra": "2026-06-08"
      },
      {
        "nome": "PANIFICADORA PANIBEJ",
        "ultimaCompra": "2026-01-20"
      },
      {
        "nome": "PANIFICADORA PAO FERREIRA",
        "ultimaCompra": "2026-06-02"
      },
      {
        "nome": "PANIFICADORA VO ANA",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "PANIFICADORA CARVALHO LOJA 2",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "PERFECT EPIS LTDA",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "PINHEIROS SUPERMERCADO",
        "ultimaCompra": "2026-08-11"
      },
      {
        "nome": "POLA LANCHES",
        "ultimaCompra": "2026-04-24"
      },
      {
        "nome": "POLA LANCHES/ PRACA ALIM. UNIV. POSITIVO",
        "ultimaCompra": "2026-06-11"
      },
      {
        "nome": "PONTO QUENTE",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "QUITANDA DA FAMILIA",
        "ultimaCompra": "2026-07-06"
      },
      {
        "nome": "QUITI CACHOEIRA",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "MINI MERCADO SAO BRAZ",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "MERCEARIA VIEIRA SANTOS",
        "ultimaCompra": "2026-05-20"
      },
      {
        "nome": "MERCOBOM ROD. DOS MIN RIOS",
        "ultimaCompra": "2026-02-19"
      },
      {
        "nome": "MEU CAFE",
        "ultimaCompra": "2026-01-12"
      },
      {
        "nome": "MINI MERCADO CIVIS PILARZINHO",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "MINI MERCADO JOSE E MARIA",
        "ultimaCompra": "2026-06-03"
      },
      {
        "nome": "PANIFICADORA CARVALHO",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "NOBRESY PAN NOVO",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "NOSSO LAR FILIAL",
        "ultimaCompra": "2026-05-28"
      },
      {
        "nome": "NOSSO LAR MERCADO E ACOUGUE",
        "ultimaCompra": "2026-05-28"
      },
      {
        "nome": "ONILDO LANCHES-LANCHONETE TERMINAL CAMPO COMPRIDO",
        "ultimaCompra": "2026-05-20"
      },
      {
        "nome": "PANETTERIA CAFE COM ROSAS",
        "ultimaCompra": "2026-05-27"
      },
      {
        "nome": "MERCEARIA SAO FRANCISCO",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "TISSI ATENAS",
        "ultimaCompra": "2026-07-20"
      },
      {
        "nome": "SUPERMERCADO PALMEIRA",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "TABOAO BEACH TENIS",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "TARTARUGAS BAR",
        "ultimaCompra": "2026-04-29"
      },
      {
        "nome": "THE AMERICAN WAY CAFE AMERICA CAFE",
        "ultimaCompra": "2026-08-11"
      },
      {
        "nome": "TICO VALENGA",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "SUPERMERCADO ASTRAL TAMANDARE BR",
        "ultimaCompra": "2026-07-30"
      },
      {
        "nome": "TISSI COTOLENGO",
        "ultimaCompra": "2026-05-26"
      },
      {
        "nome": "TISSI PILARZINHO",
        "ultimaCompra": "2026-07-20"
      },
      {
        "nome": "TISSI VILA GUAIRA",
        "ultimaCompra": "2026-04-27"
      },
      {
        "nome": "VAMO QUE VAMO 2",
        "ultimaCompra": "2026-02-19"
      },
      {
        "nome": "VSD DISTRIBUIDORA DE BEBIDAS",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "REDE MAIS",
        "ultimaCompra": "2026-07-29"
      },
      {
        "nome": "RESTAURANTE E LANCHONETE DA NONA",
        "ultimaCompra": "2026-05-06"
      },
      {
        "nome": "REDE MASTER CACHOEIRA",
        "ultimaCompra": "2026-08-07"
      },
      {
        "nome": "REDE MASTER PILARZINHO",
        "ultimaCompra": "2026-07-16"
      },
      {
        "nome": "REST CANTINA DO SABOR",
        "ultimaCompra": "2025-12-11"
      },
      {
        "nome": "RESTAURANTE CHAPLIN",
        "ultimaCompra": "2025-12-02"
      },
      {
        "nome": "RESTAURANTE CORES E SABORES",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "STOCCHERO",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "RESTAURANTE IGUACU",
        "ultimaCompra": "2025-12-11"
      },
      {
        "nome": "RESTAURANTE KI SABOR",
        "ultimaCompra": "2026-02-23"
      },
      {
        "nome": "RESTAURANTE SABOR DE CASA",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "RESTAURANTE TIA TERE",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "SMOKE AND BEER",
        "ultimaCompra": "2026-06-11"
      },
      {
        "nome": "AGILIZA DISTRIBUIDORA",
        "ultimaCompra": "2026-05-06"
      },
      {
        "nome": "DISTRIBUIDORA VIA VENETO",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "CONF. E PANIF. MESTRE",
        "ultimaCompra": "2026-06-22"
      },
      {
        "nome": "DELICIAS STRAIOTTO",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "DISTR. DE BEBIDAS DALLABEER",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "DISTRIBUIDORA AQUALANDY",
        "ultimaCompra": "2026-06-18"
      },
      {
        "nome": "DISTRIBUIDORA PINHEIROS",
        "ultimaCompra": "2026-06-02"
      },
      {
        "nome": "COMERCIO DE BEBIDAS NOGUEIRA",
        "ultimaCompra": "2026-04-22"
      },
      {
        "nome": "DM TENIS - QUIOSQUE AZUL",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "DOLCE GUSTO",
        "ultimaCompra": "2026-06-22"
      },
      {
        "nome": "DOM DA PASTA",
        "ultimaCompra": "2026-06-18"
      },
      {
        "nome": "DOM GUILHERME EVENTOS",
        "ultimaCompra": "2026-05-26"
      },
      {
        "nome": "EMPORIO FAZZINIO",
        "ultimaCompra": "2026-06-15"
      },
      {
        "nome": "EMPORIO SATURNO",
        "ultimaCompra": "2026-06-18"
      },
      {
        "nome": "BRASIL SOCCER",
        "ultimaCompra": "2026-04-23"
      },
      {
        "nome": "ARVOREDO",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "ASTRAL LOJA 3",
        "ultimaCompra": "2026-05-29"
      },
      {
        "nome": "BIG BURGUER",
        "ultimaCompra": "2026-06-03"
      },
      {
        "nome": "BOKAS - RESTAURANTE CAMARAO DOURADO",
        "ultimaCompra": "2026-06-11"
      },
      {
        "nome": "BOLOFOFOS",
        "ultimaCompra": "2025-12-29"
      },
      {
        "nome": "CIVIS SANTA FELICIDADE(tab NORMAL)",
        "ultimaCompra": "2026-08-12"
      },
      {
        "nome": "CAFE E ARTE",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "CAPELA MORTUARIA E FLORICULTURA ORLEANS",
        "ultimaCompra": "2026-05-18"
      },
      {
        "nome": "CASONI BEBIDAS",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "CIRCUITO DA GULA",
        "ultimaCompra": "2026-03-30"
      },
      {
        "nome": "CIVIS ALMIRANTE TAMANDARE",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "MERCEARIA A MURALHA",
        "ultimaCompra": "2026-05-27"
      },
      {
        "nome": "MERCADO PRIMUS cic",
        "ultimaCompra": "2026-06-15"
      },
      {
        "nome": "MERCADO ASTRAL SANTA TEREZINHA",
        "ultimaCompra": "2026-03-26"
      },
      {
        "nome": "MERCADO BAGGIO",
        "ultimaCompra": "2026-03-03"
      },
      {
        "nome": "MERCADO BASSO",
        "ultimaCompra": "2026-08-10"
      },
      {
        "nome": "MERCADO CIVIS - LOJA BRACATINGA",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "MERCADO JUNINHO",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "MERCADO 02Z",
        "ultimaCompra": "2026-06-11"
      },
      {
        "nome": "MERCADO SAO BRAZ FILIAL",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "MERCADO SAO JOSE",
        "ultimaCompra": "2026-08-12"
      },
      {
        "nome": "MERCADO SR TORRES",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "MERCADO TANGUA LTDA",
        "ultimaCompra": "2026-05-18"
      },
      {
        "nome": "MERCATTOS",
        "ultimaCompra": "2026-02-04"
      },
      {
        "nome": "ESPACO CHAVES EVENTOS",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "IMPERIO DA CARNE-SERASA",
        "ultimaCompra": "2026-03-04"
      },
      {
        "nome": "FABIANA COMUNELLO DE OLIVEIRA",
        "ultimaCompra": "2026-06-15"
      },
      {
        "nome": "FER LANCHES",
        "ultimaCompra": "2026-06-15"
      },
      {
        "nome": "FRIGO LIFE",
        "ultimaCompra": "2026-08-10"
      },
      {
        "nome": "GIAZZON GASTRONOMIA",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "GULA MAIS GULA",
        "ultimaCompra": "2026-05-06"
      },
      {
        "nome": "MARVADO GOLE",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "IPA BEER DISTRIBUIDORA",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "JH SUPERMERCADOS",
        "ultimaCompra": "2026-06-01"
      },
      {
        "nome": "KANTELE HORTIFRUTI E CEREAIS LTDA",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "LA PANETTERIA - ANTIGA DIVINA CONQUISTA",
        "ultimaCompra": "2026-06-02"
      },
      {
        "nome": "LANCHES DA FELICIDADE",
        "ultimaCompra": "2026-06-09"
      }
    ]
  },
  {
    "sellerName": "FABIANO PELANDA",
    "sellerUsername": "fabiano.pelanda",
    "customers": [
      {
        "nome": "POCKET EXPRESS",
        "ultimaCompra": "2026-08-12"
      },
      {
        "nome": "MF SEVENTH LANC E REST LTDA/ REST BERINGELA",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "MINIMERCADO MINI MAIS LTDA",
        "ultimaCompra": "2026-07-30"
      },
      {
        "nome": "O TABERNEIRO",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "PANIF. BELLA ANITA (SERASA)",
        "ultimaCompra": "2025-12-08"
      },
      {
        "nome": "PANIFICADORA 3 IRMAOS - VILA IZABEL",
        "ultimaCompra": "2026-06-30"
      },
      {
        "nome": "PANIFICADORA NINELE",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "PAULO SERGIO ALVES FRUTUOSO",
        "ultimaCompra": "2026-05-12"
      },
      {
        "nome": "MERCADO COSTA",
        "ultimaCompra": "2026-05-13"
      },
      {
        "nome": "RESTAURANTE UMBARA",
        "ultimaCompra": "2026-08-03"
      },
      {
        "nome": "SABOR FILIPINO",
        "ultimaCompra": "2026-08-12"
      },
      {
        "nome": "SANTA ARENA LTDA",
        "ultimaCompra": "2026-08-05"
      },
      {
        "nome": "SUPERMAIS SUPERMERCADO CERCADINHO",
        "ultimaCompra": "2026-01-13"
      },
      {
        "nome": "SUPERMERCADO BONATO",
        "ultimaCompra": "2026-07-15"
      },
      {
        "nome": "SUPERMERCADO GASPARIN",
        "ultimaCompra": "2026-08-17"
      },
      {
        "nome": "TCHATCHA CHOP",
        "ultimaCompra": "2026-05-27"
      },
      {
        "nome": "ADEGA BACACHERI LTDA",
        "ultimaCompra": "2026-07-29"
      },
      {
        "nome": "CENTRO EDUC INFANTIL BOSQUE DA CORUJINHA",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "ADEGA CORONEL LTDA",
        "ultimaCompra": "2026-07-08"
      },
      {
        "nome": "ADEGA XAXIM",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "ALL NATURAL -BIGORRILHO",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "ALL NATURAL BARIGUI",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "BLACK BEAR BEBIDAS E TABACARIA",
        "ultimaCompra": "2026-07-14"
      },
      {
        "nome": "CAFE E CIA",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "CASA LUCE",
        "ultimaCompra": "2026-07-07"
      },
      {
        "nome": "MARCADO BANDEIRA 3",
        "ultimaCompra": "2026-01-09"
      },
      {
        "nome": "CENTRO ESPORTIVO IPIRANGA LTDA",
        "ultimaCompra": "2026-07-21"
      },
      {
        "nome": "DIST E CONVENIENCIA RAMOS",
        "ultimaCompra": "2026-05-15"
      },
      {
        "nome": "DISTR. ESTACAO DAS BEBIDAS",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "DISTRIBUIDORA BOA VISTA",
        "ultimaCompra": "2026-01-15"
      },
      {
        "nome": "DISTRIBUIDORA DOS ESTADOS",
        "ultimaCompra": "2026-08-12"
      },
      {
        "nome": "LACQUA VERDE SUPERMERCADO(FABRICA)",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "LANCHONETE DO MINGO BAR",
        "ultimaCompra": "2026-06-08"
      }
    ]
  },
  {
    "sellerName": "MANOEL JR",
    "sellerUsername": "manoel.jr",
    "customers": [
      {
        "nome": "MERCEARIA JUBILEU",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "SOBERANO BOQUEIRAO",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "PLANETA AGUA",
        "ultimaCompra": "2026-03-11"
      },
      {
        "nome": "PANIFICADORA FAMILIA OSTEN",
        "ultimaCompra": "2026-07-08"
      },
      {
        "nome": "NILSON WOSNES",
        "ultimaCompra": "2026-04-17"
      },
      {
        "nome": "MEU QUINTAL MAIOR QUE O MUNDO",
        "ultimaCompra": "2026-05-26"
      },
      {
        "nome": "SOBERANO XAXIM",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "MERCADO XAVIER",
        "ultimaCompra": "2026-08-06"
      },
      {
        "nome": "MERCADO TOKARSKI",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "MERCADO SOUZA",
        "ultimaCompra": "2026-06-22"
      },
      {
        "nome": "MERCADO SANTO ANTONIO",
        "ultimaCompra": "2026-03-11"
      },
      {
        "nome": "MERCADO SANTANA",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "MERCADO PALACIO BOQUEIRAO",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "SUPERMERCADO SIERRA SITIO CERCADO",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "VOLPI XAPINHAL-SITIO CERCADO",
        "ultimaCompra": "2026-04-07"
      },
      {
        "nome": "VOLPI TATUQUARA",
        "ultimaCompra": "2026-05-29"
      },
      {
        "nome": "VOLPI RIO BONITO-CAMPO DE SANTANA",
        "ultimaCompra": "2026-04-07"
      },
      {
        "nome": "VIA VENETO",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "SUPER DANTON",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "SUPERMERCADO JUNIOR",
        "ultimaCompra": "2026-07-29"
      },
      {
        "nome": "SUPERMERCADO DU LEO MATRIZ",
        "ultimaCompra": "2026-04-23"
      },
      {
        "nome": "SUPERMERCADO DU LEO GOURMET- SERASA",
        "ultimaCompra": "2026-04-23"
      },
      {
        "nome": "SUPERMERCADO BELEM",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "SUPER G",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "S.MARCHESKI - LTDA",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "CANTINA POLITECNICO",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "DISTRIBUIDORA ALINE",
        "ultimaCompra": "2026-01-27"
      },
      {
        "nome": "DISTRIBUIDORA ADRIJUNIOR",
        "ultimaCompra": "2026-05-12"
      },
      {
        "nome": "DGLUTTEN PAN PANIFICADORA",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "CLAY HIGHWAY BAR",
        "ultimaCompra": "2026-08-20"
      },
      {
        "nome": "DISTRIBUIDORA DO PARAGUAIO",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "CANTINA CIENCIAS DA TERRA",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "CANTINA BOTANICA",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "CANTINA BARROMEO",
        "ultimaCompra": "2026-07-27"
      },
      {
        "nome": "BASTARDS TAPROOM LTDA",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "A GRANDE GULA",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "MERCADO MANDA BRASA",
        "ultimaCompra": "2026-07-08"
      },
      {
        "nome": "L&G FRUTARIA",
        "ultimaCompra": "2025-12-05"
      },
      {
        "nome": "MERCADO IGUA",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "MERCADO E ACOUGUE BOM JESUS",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "MERCADO COIADO",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "LIOTO DISTRIBUIDORA",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "DISTRIBUIDORA FORTE",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "JESSICA - L QUINELLI",
        "ultimaCompra": "2026-06-18"
      },
      {
        "nome": "GULA MANIA",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "GULA DA FAMILIA MERCEARIA",
        "ultimaCompra": "2026-06-05"
      },
      {
        "nome": "FRUTARIA MAURICIO",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "DISTRIBUIDORA HOUSE BER",
        "ultimaCompra": "2026-06-10"
      }
    ]
  },
  {
    "sellerName": "MARCOS SCHULTZ",
    "sellerUsername": "marcos.schultz",
    "customers": [
      {
        "nome": "NH HOTEL",
        "ultimaCompra": "2026-01-26"
      },
      {
        "nome": "POSTO CONDOR CHAMPAGNAT",
        "ultimaCompra": "2026-02-10"
      },
      {
        "nome": "POSTO CONDOR AVENIDA DAS ARAUCARIAS LTDA",
        "ultimaCompra": "2026-01-26"
      },
      {
        "nome": "POSTO CONDOR ATUBA LTDA",
        "ultimaCompra": "2026-01-26"
      },
      {
        "nome": "PORTO CB DISTRIBUIDORA ALIMENTICIA LTDA",
        "ultimaCompra": "2026-06-01"
      },
      {
        "nome": "PORTERHOUSE",
        "ultimaCompra": "2025-12-22"
      },
      {
        "nome": "PIZZARIA FATILE",
        "ultimaCompra": "2025-12-22"
      },
      {
        "nome": "PADARIA AMERICA BACACHERI",
        "ultimaCompra": "2026-07-30"
      },
      {
        "nome": "O FERRAGISTA",
        "ultimaCompra": "2026-02-27"
      },
      {
        "nome": "POSTO CONDOR LINHA VERDE I",
        "ultimaCompra": "2026-01-27"
      },
      {
        "nome": "MINI MERCADO ARAUJO",
        "ultimaCompra": "2026-08-05"
      },
      {
        "nome": "MIG ATACADO E VAREJO LTDA",
        "ultimaCompra": "2026-06-18"
      },
      {
        "nome": "MERCEARIA SAO MARCOS",
        "ultimaCompra": "2026-07-08"
      },
      {
        "nome": "MERCADO WENCESLAU",
        "ultimaCompra": "2026-07-17"
      },
      {
        "nome": "MADALOZO MORRETES",
        "ultimaCompra": "2026-07-21"
      },
      {
        "nome": "MADALOSSO",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "LA CASA DI FRANGO",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "KIREI - YASSAI - FRUTAS E VERDURAS",
        "ultimaCompra": "2026-08-10"
      },
      {
        "nome": "KF LANCHES",
        "ultimaCompra": "2026-08-14"
      },
      {
        "nome": "RESTAURANTE LAMENHA LINS",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "ZAMPROGNA SUPERMERCADO",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "TONINHOS MERCADO",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "TOKO PINHEIRINHO",
        "ultimaCompra": "2026-07-21"
      },
      {
        "nome": "TOK SUPER CAPAO",
        "ultimaCompra": "2026-08-10"
      },
      {
        "nome": "SENADOR VEICULOS",
        "ultimaCompra": "2026-06-19"
      },
      {
        "nome": "RESTAURANTE RANCHO E PROSA",
        "ultimaCompra": "2026-08-13"
      },
      {
        "nome": "RESTAURANTE MORIA",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "POSTO CONDOR LINHA VERDE II LTDA",
        "ultimaCompra": "2026-01-26"
      },
      {
        "nome": "RESTAURANTE JHONNY BAGGIO",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "RESTAURANTE DUE CHEF",
        "ultimaCompra": "2026-07-23"
      },
      {
        "nome": "QUALITY HOTEL",
        "ultimaCompra": "2026-08-14"
      },
      {
        "nome": "POUSADA DONA SIROBA",
        "ultimaCompra": "2026-03-25"
      },
      {
        "nome": "POSTO CONDOR WESTPHALEN LTDA",
        "ultimaCompra": "2026-05-19"
      },
      {
        "nome": "POSTO CONDOR TARUMA LTDA",
        "ultimaCompra": "2026-01-26"
      },
      {
        "nome": "POSTO CONDOR SAO JOSE LTDA",
        "ultimaCompra": "2026-02-09"
      },
      {
        "nome": "POSTO CONDOR RODOVIARIA LTDA",
        "ultimaCompra": "2026-04-20"
      },
      {
        "nome": "FABIANO W STELZNER - SERASA",
        "ultimaCompra": "2026-03-10"
      },
      {
        "nome": "BRIDAROLLI",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "COSTELAO TRADICAO",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "COLEGIO DA POLICIA",
        "ultimaCompra": "2026-08-14"
      },
      {
        "nome": "CIA DO BOLO",
        "ultimaCompra": "2026-01-06"
      },
      {
        "nome": "CANTINA COLEGIO SESI - BOQUEIRAO",
        "ultimaCompra": "2026-05-25"
      },
      {
        "nome": "CANTINA COLEGIO SESI",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "CANTINA COLEGIO ELITE",
        "ultimaCompra": "2026-06-09"
      },
      {
        "nome": "BUFFEST GASTRONOMIA E EVENTOS LTDA",
        "ultimaCompra": "2026-06-11"
      },
      {
        "nome": "COSTELAO TROPEIROS",
        "ultimaCompra": "2026-06-24"
      },
      {
        "nome": "BEEF E CIA",
        "ultimaCompra": "2026-05-25"
      },
      {
        "nome": "BANQUETE ARABE",
        "ultimaCompra": "2026-06-09"
      },
      {
        "nome": "BANCA DO SOL",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "AVP BEBIDAS",
        "ultimaCompra": "2026-04-16"
      },
      {
        "nome": "ARTE DA COZINHA RESTAURANTE",
        "ultimaCompra": "2026-06-10"
      },
      {
        "nome": "ADORATTO SUPERMERCADO",
        "ultimaCompra": "2026-07-23"
      },
      {
        "nome": "A .MADALOZO & CIA LTDA - INATIVO",
        "ultimaCompra": "2026-02-10"
      },
      {
        "nome": "MAGIC TAPETES",
        "ultimaCompra": "2026-05-29"
      },
      {
        "nome": "JUJUBELA RESTAURANTE",
        "ultimaCompra": "2025-12-18"
      },
      {
        "nome": "HOTEL BRISTOL(RESTAURANTE)",
        "ultimaCompra": "2026-08-17"
      },
      {
        "nome": "IBIS CURITIBA AEROPORTO",
        "ultimaCompra": "2026-08-07"
      },
      {
        "nome": "IBIS BUDGET CURITIBA",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "IBIS BATEL-NOVOTEL",
        "ultimaCompra": "2026-07-10"
      },
      {
        "nome": "HOTEL REST NHUNDIAQUARA MORRETES",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "HOTEL INTERCITY/SOMENTE PEDIDO",
        "ultimaCompra": "2026-08-11"
      },
      {
        "nome": "HOTEL INTERCITY BATEL",
        "ultimaCompra": "2026-07-23"
      },
      {
        "nome": "HOTEL GRAND MERCURE CURITIBA",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "DINA PIZZA",
        "ultimaCompra": "2026-03-30"
      },
      {
        "nome": "HOTEL BETANIA",
        "ultimaCompra": "2026-08-06"
      },
      {
        "nome": "EUROPA- ARAUCARIA (Tab Fabrica)",
        "ultimaCompra": "2026-06-16"
      },
      {
        "nome": "ESTILO GRILL",
        "ultimaCompra": "2026-08-05"
      },
      {
        "nome": "ESPACO HIPICA EVENTOS E GASTRONOMIA",
        "ultimaCompra": "2026-04-28"
      },
      {
        "nome": "EMPORIO GULA GULA BACACHERI",
        "ultimaCompra": "2026-08-19"
      },
      {
        "nome": "DOM ANGELO PRATOS E PETISCOS",
        "ultimaCompra": "2026-08-07"
      },
      {
        "nome": "DISTRIBUIDORA OURIZONA",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "DISTRIBUIDORA BEBIDAS CAPAO DA IMBUIA",
        "ultimaCompra": "2026-01-14"
      }
    ]
  },
  {
    "sellerName": "ANTONIO ALVES DA SILVA",
    "sellerUsername": "antonio.alves.da.silva",
    "customers": [
      {
        "nome": "SANTA HELENA GUARAITUBA(FABRICA)",
        "ultimaCompra": "2026-07-28"
      },
      {
        "nome": "PANIFICADORA BAIRRO ALTO",
        "ultimaCompra": "2026-05-12"
      },
      {
        "nome": "PANIFICADORA SAN JOSE",
        "ultimaCompra": "2026-06-25"
      },
      {
        "nome": "REI DA GULA",
        "ultimaCompra": "2026-06-02"
      },
      {
        "nome": "SANTA HELENA ATALAIA",
        "ultimaCompra": "2026-05-28"
      },
      {
        "nome": "SANTA HELENA CAMPO PEQUENO(FABRICA)",
        "ultimaCompra": "2026-06-17"
      },
      {
        "nome": "PANIF CONF. DAMAE",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "SUPER IDEAL - STA LUCIA",
        "ultimaCompra": "2026-04-23"
      },
      {
        "nome": "SUPER MERCADO FARIAS",
        "ultimaCompra": "2026-02-26"
      },
      {
        "nome": "SUPER MERCADO FARIAS BELA VISTA",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "SUPERMERCADO FARIAS SANTA MONICA",
        "ultimaCompra": "2026-08-18"
      },
      {
        "nome": "SUPERMERCADO SALOME",
        "ultimaCompra": "2026-07-08"
      },
      {
        "nome": "TOCA DA BEBIDA",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "BEERHOUSE",
        "ultimaCompra": "2026-01-05"
      },
      {
        "nome": "GELSON DE OLIVEIRA DA LUZ",
        "ultimaCompra": "2026-05-22"
      },
      {
        "nome": "CHURRASCARIA BOI DOURADO",
        "ultimaCompra": "2026-07-10"
      },
      {
        "nome": "CLAUDIO VINICIUS MARTINS BAR E LANCHONETE ME",
        "ultimaCompra": "2026-05-04"
      },
      {
        "nome": "DISTRIBUIDORA DINIZ",
        "ultimaCompra": "2026-06-23"
      },
      {
        "nome": "DISTRIBUIDORA RAIMUNDUS",
        "ultimaCompra": "2026-05-28"
      },
      {
        "nome": "FORTS BEER",
        "ultimaCompra": "2026-02-11"
      },
      {
        "nome": "MINI PRECO UBERABA",
        "ultimaCompra": "2026-08-03"
      },
      {
        "nome": "JULIANA BARBOSA BONFIM",
        "ultimaCompra": "2026-06-05"
      },
      {
        "nome": "MERCADO DO FARIAS- G.FARIAS",
        "ultimaCompra": "2026-07-29"
      },
      {
        "nome": "MERCADO ROYAL",
        "ultimaCompra": "2026-08-12"
      },
      {
        "nome": "MERCEARIA BEEHAUS",
        "ultimaCompra": "2026-01-05"
      },
      {
        "nome": "MINI PRECO CAJURU",
        "ultimaCompra": "2026-07-31"
      },
      {
        "nome": "MINI PRECO PINHAIS",
        "ultimaCompra": "2026-07-31"
      }
    ]
  }
];

module.exports = { SELLERS, CUSTOMER_PORTFOLIOS };
