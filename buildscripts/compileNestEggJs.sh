#!/bin/bash

dir=`pwd`

# set up the build directory
mkdir build
cd build

mkdir js
cd js

mkdir root
mkdir libnestegg
cd libnestegg

# finally, run configuration script
EMCONFIGURE_JS=1 NM=/usr/bin/nm emconfigure ../../../libnestegg/configure --prefix="$dir/build/js/root"

# compile libnestegg
emmake make -j4
emmake make install

cd ..
cd ..
cd ..
