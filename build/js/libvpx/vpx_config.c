/* Copyright (c) 2011 The WebM project authors. All Rights Reserved. */
/*  */
/* Use of this source code is governed by a BSD-style license */
/* that can be found in the LICENSE file in the root of the source */
/* tree. An additional intellectual property rights grant can be found */
/* in the file PATENTS.  All contributing project authors may */
/* be found in the AUTHORS file in the root of the source tree. */
#include "vpx/vpx_codec.h"
static const char* const cfg = "--prefix=/home/chris/Respostories/chrislearn/ogv.js/build/js/root --target=generic-gnu --extra-cflags=-I/opt/emsdk/emscripten/master/system/lib/libcxxabi/include/ --disable-multithread --enable-vp9-decoder --disable-vp8-encoder --disable-vp9-encoder --enable-shared --disable-docs --disable-examples";
const char *vpx_codec_build_config(void) {return cfg;}
