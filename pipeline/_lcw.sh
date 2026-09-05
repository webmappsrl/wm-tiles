set -e
cd /work
echo "== lc3857 sull'area estesa"
gdalwarp -overwrite -q -t_srs EPSG:3857 -r mode \
  -te_srs EPSG:4326 -te 10.0 43.62 10.9 44.5 \
  -co COMPRESS=DEFLATE landcover-src/worldcover_N42E009.tif lc3857.tif
gdalinfo lc3857.tif | grep -E "Size is|Pixel Size"
bash /pipeline/build-landcover-vector.sh /work/lcw.geojsonl
