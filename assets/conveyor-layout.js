/* Conveyor equipment traced from the two supplied floor plans.
 * Coordinates use the displayed 2F plan coordinate system (rack rows y=76..847).
 * 1F plan coordinates have y -= 262 so both floors share the same rack footprint.
 * Missing on the 1F drawing: 1005, 1030, 1052, 1098. Do not invent those IDs.
 * A junction's optional extensions are the adjoining short roller section that
 * carries the same equipment number on the plan. Unnumbered grid links are not
 * separate devices and should be rendered as connecting geometry by the viewer.
 */
(function () {
  'use strict';
  const layout = { 1: [], 2: [] };
  function add(floor, id, kind, x1, y1, x2, y2, extensions) {
    const dy = floor === 1 ? 262 : 0;
    const segment = { id: String(id), kind, x1, y1: y1 - dy, x2, y2: y2 - dy };
    if (extensions) segment.extensions = extensions.map(r => ({
      x1: r[0], y1: r[1] - dy, x2: r[2], y2: r[3] - dy
    }));
    layout[floor].push(segment);
  }
  function branch(floor, y, near, far) {
    add(floor, near, 'branch', 300, y - 11, 358, y + 11);
    add(floor, far, 'branch', 358, y - 11, 414, y + 11);
  }
  function left(floor, y, far, near) {
    if (far) add(floor, far, 'branch', 72, y - 11, 129, y + 11);
    add(floor, near, 'branch', 129, y - 11, 187, y + 11);
  }
  function junction(floor, id, x, y) {
    add(floor, id, 'junction', x - 19, y - 19, x + 19, y + 19);
  }
  function trunk(floor, id, x, y1, y2) {
    add(floor, id, 'trunk', x - 12, y1, x + 12, y2);
  }

  // 1F: ten rack-side branches, from the top rack row downwards.
  [
    [338, 1029, 1028], [417, 1025, 1024], [497, 1023, 1022],
    [590, 1019, 1018], [670, 1017, 1016], [763, 1013, 1012],
    [843, 1011, 1010], [935, 1007, 1006], [1015, 1004, 1003],
    [1108, 1002, 1001]
  ].forEach(r => branch(1, ...r));
  [[417, 1027, 1026], [670, 1021, 1020], [763, 1015, 1014], [1015, 1009, 1008]]
    .forEach(r => left(1, ...r));

  // 1F inner transfer junctions (x=282), and outer junctions (x=205).
  [[338, 1064], [417, 1062], [497, 1061], [590, 1059], [670, 1058],
   [763, 1056], [843, 1055], [935, 1053], [1015, 1051], [1108, 1050], [241, 1066]]
    .forEach(r => junction(1, r[1], 282, r[0]));
  [[169, 1075], [338, 1065], [417, 1063], [670, 1060], [763, 1057], [1015, 1054]]
    .forEach(r => junction(1, r[1], 205, r[0]));

  [[1081, 260, 319], [1080, 357, 398], [1079, 516, 571],
   [1078, 689, 744], [1077, 862, 916], [1076, 1034, 1089]]
    .forEach(r => trunk(1, r[0], 282, r[1], r[2]));
  [[1082, 188, 319], [1083, 357, 398], [1084, 436, 592], [1099, 592, 651],
   [1085, 689, 744], [1100, 782, 853], [1086, 853, 925], [1087, 925, 996]]
    .forEach(r => trunk(1, r[0], 205, r[1], r[2]));

  // 1F front/header network: lower horizontal line at y=241.
  [[1031, 300, 454], [1032, 454, 572], [1033, 572, 684], [1034, 684, 725],
   [1035, 801, 929], [1036, 929, 980], [1037, 1060, 1195], [1038, 1195, 1221],
   [1039, 1300, 1405], [1040, 1405, 1500]]
    .forEach(r => add(1, r[0], 'header', r[1], 230, r[2], 252));
  add(1, 1067, 'junction', 725, 205, 763, 252, [[763, 230, 801, 252]]);
  add(1, 1068, 'junction', 980, 205, 1018, 252, [[1018, 230, 1060, 252]]);
  add(1, 1069, 'junction', 1221, 205, 1259, 252, [[1259, 230, 1300, 252]]);

  // 1F upper horizontal line at y=169, with five external finger lines.
  [[1049, 224, 442], [1048, 442, 564], [1047, 564, 684], [1046, 684, 725],
   [1045, 803, 852], [1044, 937, 980], [1043, 1060, 1102], [1042, 1180, 1221],
   [1041, 1300, 1405]]
    .forEach(r => add(1, r[0], 'header', r[1], 158, r[2], 180));
  add(1, 1074, 'junction', 725, 129, 763, 205, [[763, 158, 803, 180]]);
  add(1, 1073, 'junction', 852, 129, 889, 180, [[889, 158, 937, 180]]);
  add(1, 1072, 'junction', 980, 129, 1018, 205, [[1018, 158, 1060, 180]]);
  add(1, 1071, 'junction', 1102, 129, 1140, 180, [[1140, 158, 1180, 180]]);
  add(1, 1070, 'junction', 1221, 129, 1259, 205, [[1259, 158, 1300, 180]]);
  [[744, 1093, 1092], [870, 1088, 1094], [999, 1089, 1095],
   [1121, 1090, 1096], [1240, 1091, 1097]].forEach(r => {
    trunk(1, r[1], r[0], 33, 76);
    trunk(1, r[2], r[0], 76, 129);
  });

  // 2F: ten rack-side branches, from the top rack row downwards.
  [[76, 2029, 2028], [155, 2026, 2025], [235, 2022, 2021], [328, 2020, 2019],
   [408, 2016, 2015], [501, 2014, 2013], [581, 2010, 2009], [674, 2008, 2007],
   [754, 2004, 2003], [847, 2002, 2001]]
    .forEach(r => branch(2, ...r));
  [[76, 2056, 2030], [155, null, 2027], [235, 2024, 2023],
   [408, 2018, 2017], [581, 2012, 2011], [754, 2006, 2005]]
    .forEach(r => left(2, ...r));
  // 2056 is visibly wider across the conveyor direction than the adjacent 2030.
  Object.assign(layout[2].find(s => s.id === '2056'), { y1: 59, y2: 92 });

  [[76, 2040], [155, 2039], [235, 2038], [328, 2037], [408, 2036],
   [501, 2035], [581, 2034], [674, 2033], [754, 2032], [847, 2031]]
    .forEach(r => junction(2, r[1], 282, r[0]));
  [[76, 2041], [155, 2042], [235, 2043], [408, 2044], [581, 2045], [754, 2046]]
    .forEach(r => junction(2, r[1], 205, r[0]));
  [[2051, 95, 136], [2050, 254, 309], [2049, 427, 482],
   [2048, 600, 655], [2047, 773, 828]]
    .forEach(r => trunk(2, r[0], 282, r[1], r[2]));
  [[2052, 95, 136], [2053, 254, 389], [2054, 427, 562], [2055, 600, 735]]
    .forEach(r => trunk(2, r[0], 205, r[1], r[2]));

  Object.values(layout).forEach(segments => segments.sort((a, b) => Number(a.id) - Number(b.id)));
  window.WCS_CONVEYOR_LAYOUT = layout;
}());
