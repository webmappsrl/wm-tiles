-- POI puntuali che lo schema OpenMapTiles non porta, o porta troppo tardi:
-- cime, valichi, sorgenti, rifugi minori, punti panoramici, le uscite
-- autostradali (in TGen `#junctions`, da z11) e le localita' (`place=locality`
-- e `farm`, che il layer `place` di OpenMapTiles scarta e TGen scrive da z15
-- in `placenames-small`).
-- Dal 14/10/2026 tutte le classi di placenames-small: i nomi vanno spezzati
-- come Mapnik nel dato, e quelli di OpenMapTiles non si possono toccare.
--
-- Il nome serve solo a cio' che si scrive e basta. Per le icone TGen non lo
-- chiede (amenity-points non filtra sul nome): rifugi, bivacchi, ripari, selle,
-- sorgenti e grotte entrano anche senza, e fino all'11/10/2026 mancavano. I
-- rifugi disegnati come aree li prende osmpoi-aree.sql.
--
-- Il dialetto OGRSQL non ha COALESCE ne' CASE: i tre tag si estraggono in
-- colonne separate e `kind` si compone dopo, con jq. `highway`, `ref` e `place`
-- sono colonne proprie del layer `points` del driver OSM.
SELECT name,
       highway,
       ref,
       place,
       hstore_get_value(other_tags, 'natural')       AS t_natural,
       hstore_get_value(other_tags, 'tourism')       AS t_tourism,
       hstore_get_value(other_tags, 'amenity')       AS t_amenity,
       hstore_get_value(other_tags, 'mountain_pass') AS t_pass,
       hstore_get_value(other_tags, 'ele')           AS ele
FROM points
WHERE (other_tags IS NOT NULL
  AND (
    hstore_get_value(other_tags, 'natural') IN ('saddle','spring','cave_entrance')
    OR hstore_get_value(other_tags, 'tourism') IN ('alpine_hut','wilderness_hut')
    OR hstore_get_value(other_tags, 'amenity') = 'shelter'
  ))
  OR (name IS NOT NULL
  AND other_tags IS NOT NULL
  AND (
    hstore_get_value(other_tags, 'natural') IN ('peak','volcano')
    OR hstore_get_value(other_tags, 'tourism') IN ('viewpoint','picnic_site')
    OR hstore_get_value(other_tags, 'amenity') = 'drinking_water'
    OR hstore_get_value(other_tags, 'mountain_pass') = 'yes'
  ))
  OR (name IS NOT NULL AND place IN ('village','hamlet','suburb','quarter','neighbourhood',
                                     'locality','isolated_dwelling','farm'))
  OR (highway = 'motorway_junction' AND (name IS NOT NULL OR ref IS NOT NULL))
