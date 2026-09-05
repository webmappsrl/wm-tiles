set -e
cd /work
W=10.0; S=43.62; E=10.9; N=44.5
echo "== VRT con cubicspline (nearest duplica i pixel del DEM a 30 m)"
gdalbuildvrt -overwrite -q -resolution highest -r cubicspline \
  dem_mosaic.vrt dem-src/*.tif dem-hr/pradarena_5m_4326.tif
echo "== dem3857.tif su $W,$S,$E,$N"
gdalwarp -overwrite -q -t_srs EPSG:3857 -r cubicspline -multi \
  -te_srs EPSG:4326 -te $W $S $E $N \
  -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER dem_mosaic.vrt dem3857.tif
gdalinfo dem3857.tif | grep -E "Size is|Pixel Size"
echo "== terrain z8-16, un ricampionamento per livello"
bash /pipeline/build-terrain-zoom.sh /work 8 16
