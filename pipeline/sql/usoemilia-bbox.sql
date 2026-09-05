COPY (
  SELECT json_build_object(
           'type','Feature',
           'properties', json_build_object('coduso', d.coduso, 'src', 'usoemilia'),
           'geometry', ST_AsGeoJSON(ST_Transform(d.geom,4326))::json)::text
  FROM ( SELECT gid, geom, CASE WHEN cod_tot IN ('1111', '1112', '1120', '1211', '1212', '1213', '1214', '1332', '5111', '5113', '1430') THEN 'fondogiallo' WHEN cod_tot IN ('1215', '1221', '1222', '1223', '1224', '1225', '1226', '1231', '1232', '1233', '1241', '1242', '1243', '1311', '1312', '1321', '1322', '1323', '1331', '1426', '1428', '3310', '3320', '3331') THEN 'bianco' WHEN cod_tot IN ('1411') THEN 'verdeurb' WHEN cod_tot IN ('1421', '1422', '1423', '1424', '1425') THEN 'ricsport' WHEN cod_tot IN ('1412', '1427', '2110', '2121', '2122', '2123', '2410', '2420', '2430', '5112') THEN 'verdeneutro' WHEN cod_tot IN ('2130', '4110', '4120') THEN 'pascolo' WHEN cod_tot IN ('4211', '4212', '4213', '4220') THEN 'zumide' WHEN cod_tot IN ('2210') THEN 'vigneti' WHEN cod_tot IN ('2220') THEN 'frutteti' WHEN cod_tot IN ('2230') THEN 'oliveti' WHEN cod_tot IN ('2241', '2242', '3130') THEN 'bosco' WHEN cod_tot IN ('2310', '3210', '3332') THEN 'pascolo' WHEN cod_tot IN ('3111', '3112', '3113', '3114', '3115') THEN 'blatifoglie' WHEN cod_tot IN ('3120') THEN 'bconifere' WHEN cod_tot IN ('3220', '3231', '3232') THEN 'arbusti' WHEN cod_tot IN ('5114', '5121', '5122', '5123', '5124') THEN 'acque' ELSE 'red' END AS coduso FROM uso_emilia_2008 ) AS d
  WHERE d.geom && ST_MakeEnvelope(1113195,5439905,1213382,5543148,3857)
) TO STDOUT
