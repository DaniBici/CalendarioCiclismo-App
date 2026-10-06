// Códigos de nacionalidad publicados por UCI (incluye códigos deportivos).
export const ISO3to2 = {
  AFG:'af', AND:'ad', ANG:'ao', ARU:'aw', BAH:'bs', BAR:'bb', BER:'bm', BUR:'bf',
  CMR:'cm', COD:'cd', GRN:'gd', IVB:'vg', JAM:'jm', MAC:'mo', MON:'mc', MRI:'mu',
  NAM:'na', PUR:'pr', REF:'xx', SIN:'sg', SLE:'sl', SMR:'sm', TTO:'tt', UGA:'ug',
  HON:'hn', UZB:'uz', PHI:'ph', BEL:'be', DEN:'dk', KAZ:'kz', AUT:'at', JPN:'jp', CHN:'cn',
  SLO:'si', UKR:'ua', INA:'id', THA:'th', MAS:'my', COL:'co', ECU:'ec', ALG:'dz', MAR:'ma',
  GBR:'gb', GER:'de', NED:'nl', NOR:'no', SWE:'se', SUI:'ch', USA:'us', AUS:'au', CAN:'ca',
  IRL:'ie', CZE:'cz', SVK:'sk', GRE:'gr', ISR:'il', TUR:'tr', RSA:'za', NZL:'nz', ERI:'er',
  RWA:'rw', IND:'in', IRI:'ir', HKG:'hk', KOR:'kr', TPE:'tw', SGP:'sg', VIE:'vn', BRA:'br',
  ARG:'ar', CHI:'cl', URU:'uy', VEN:'ve', MEX:'mx', CRC:'cr', GUA:'gt', CUB:'cu', PAN:'pa', BIZ:'bz',
  LUX:'lu', EST:'ee', LAT:'lv', LTU:'lt', FIN:'fi', ROU:'ro', BUL:'bg', CRO:'hr', SRB:'rs',
  HUN:'hu', BLR:'by', RUS:'ru', KSA:'sa', UAE:'ae', QAT:'qa', BRN:'bh', KUW:'kw', OMA:'om',
  EGY:'eg', TUN:'tn', ETH:'et', KEN:'ke', NGR:'ng', CYP:'cy', MLT:'mt', MGL:'mn', POL:'pl',
  POR:'pt', ESP:'es', ITA:'it', FRA:'fr', KGZ:'kg', GUM:'gu', BOL:'bo', KOS:'xk', ESA:'sv',
  SVN:'si', LIE:'li', MKD:'mk', AZE:'az', GEO:'ge', ARM:'am', MDA:'md', MNE:'me', BIH:'ba',
  ALB:'al', LBN:'lb', SYR:'sy', IRQ:'iq', JOR:'jo', PAK:'pk', SRI:'lk', BAN:'bd', NEP:'np',
  MYA:'mm', CAM:'kh', LAO:'la', BRU:'bn', PER:'pe', PAR:'py', DOM:'do', HAI:'ht',
  NCA:'ni', HKO:'hk', HND:'hn', HKD:'hk',
  BEN:'bj', BDI:'bi', SEN:'sn', GAB:'ga', CIV:'ci', MLI:'ml', TOG:'tg', GHA:'gh', NIG:'ne', CGO:'cg',
  GUI:'gn', MAD:'mg', TAN:'tz', ZAM:'zm', ZIM:'zw', BOT:'bw', MOZ:'mz', LBA:'ly', SUD:'sd',
  TKM:'tm', TJK:'tj', ISL:'is', PLE:'ps',
};
export const countryCode = code => ISO3to2[String(code || "").toUpperCase()] || null;
