"""Da aree a punti: un punto sicuramente interno a ogni area, con le stesse proprieta'.

Serve per i simboli che TGen mette dentro un'area (amenity-points-poly: i rifugi
disegnati come edifici). Il punto e' `PointOnSurface`, come `ST_PointOnSurface`
di PostGIS: a differenza del baricentro cade sempre dentro, anche in un'area a
forma di L.

Gira nell'immagine GDAL (serve osgeo). Uso:
  python3 punto-interno.py <in.geojsonl> <out.geojsonl>
"""
import json
import sys

from osgeo import ogr

ogr.UseExceptions()

with open(sys.argv[1]) as src, open(sys.argv[2], 'w') as out:
    for riga in src:
        ft = json.loads(riga.lstrip('\x1e'))
        g = ft.get('geometry')
        if not g:
            continue
        punto = ogr.CreateGeometryFromJson(json.dumps(g)).PointOnSurface()
        if punto is None or punto.IsEmpty():
            continue
        ft['geometry'] = json.loads(punto.ExportToJson())
        out.write(json.dumps(ft, ensure_ascii=False) + '\n')
