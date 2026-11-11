#!/bin/sh
# Download the MICrONS source files MouseHarp is built from (about 1.1 GB) into tools/microns_data/
set -e
D="${MICRONS_DATA:-$(dirname "$0")/microns_data}"; mkdir -p "$D"; cd "$D"
curl -L -o connectome_v1412.h5 "https://zenodo.org/api/records/16744240/files/microns_mm3_connectome_v1412.h5/content"
curl -L -o node_data_v1.pkl "https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/functional_data/functional_connectomics/node_and_edge_properties/v1/node_data_v1.pkl"
echo "done: $D"
