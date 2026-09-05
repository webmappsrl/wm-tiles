set -e
cd /work
echo "== VRT con cubicspline (era nearest: da li' i gradini)"
gdalbuildvrt -overwrite -q -resolution highest -r cubicspline \
  dem_mosaic.vrt dem-src/*.tif dem-hr/pradarena_5m_4326.tif
echo "== dem3857.tif"
gdalwarp -overwrite -q -t_srs EPSG:3857 -r cubicspline -multi \
  -te_srs EPSG:4326 -te 10.0 43.9 10.9 44.5 \
  -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER dem_mosaic.vrt dem3857.tif
gdalinfo dem3857.tif | grep -E "Size is|Pixel Size"
echo "== terrain z8-16, un ricampionamento per livello"
bash /pipeline/build-terrain-zoom.sh /work 8 16
