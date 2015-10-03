/**
 * @param HTMLCanvasElement canvas
 * @constructor
 */
function FrameSink(canvas, videoInfo) {
 var self = this,
  ctx = canvas.getContext('2d'),
  imageData = null,
  resampleCanvas = null,
  resampleContext = null;
/**
 * Basic YCbCr->RGB conversion
 *
 * @author Brion Vibber <brion@pobox.com>
 * @copyright 2014
 * @license MIT-style
 *
 * @param ybcbr {bytesY, bytesCb, bytesCr, strideY, strideCb, strideCr, width, height, hdec, vdec}
 * @param TypedArray output: CanvasPixelArray or Uint8ClampedArray to draw RGBA into
 * Assumes that the output array already has alpha channel set to opaque.
 */
function convertYCbCr(ybcbr, output) {
 var width = ybcbr.width,
  height = ybcbr.height,
  hdec = ybcbr.hdec,
  vdec = ybcbr.vdec,
  bytesY = ybcbr.bytesY,
  bytesCb = ybcbr.bytesCb,
  bytesCr = ybcbr.bytesCr,
  strideY = ybcbr.strideY,
  strideCb = ybcbr.strideCb,
  strideCr = ybcbr.strideCr,
  outStride = 4 * width,
  YPtr = 0, Y0Ptr = 0, Y1Ptr = 0,
  CbPtr = 0, CrPtr = 0,
  outPtr = 0, outPtr0 = 0, outPtr1 = 0,
  colorCb = 0, colorCr = 0,
  multY = 0, multCrR = 0, multCbCrG = 0, multCbB = 0,
  x = 0, y = 0, xdec = 0, ydec = 0;
 if (hdec == 1 && vdec == 1) {
  // Optimize for 4:2:0, which is most common
  outPtr0 = 0;
  outPtr1 = outStride;
  ydec = 0;
  for (y = 0; y < height; y += 2) {
   Y0Ptr = y * strideY;
   Y1Ptr = Y0Ptr + strideY;
   CbPtr = ydec * strideCb;
   CrPtr = ydec * strideCr;
   for (x = 0; x < width; x += 2) {
    colorCb = bytesCb[CbPtr++];
    colorCr = bytesCr[CrPtr++];
    // Quickie YUV conversion
    // https://en.wikipedia.org/wiki/YCbCr#ITU-R_BT.2020_conversion
    // multiplied by 256 for integer-friendliness
    multCrR = (409 * colorCr) - 57088;
    multCbCrG = (100 * colorCb) + (208 * colorCr) - 34816;
    multCbB = (516 * colorCb) - 70912;
    multY = (298 * bytesY[Y0Ptr++]);
    output[outPtr0++] = (multY + multCrR) >> 8;
    output[outPtr0++] = (multY - multCbCrG) >> 8;
    output[outPtr0++] = (multY + multCbB) >> 8;
    outPtr0++;
    multY = (298 * bytesY[Y0Ptr++]);
    output[outPtr0++] = (multY + multCrR) >> 8;
    output[outPtr0++] = (multY - multCbCrG) >> 8;
    output[outPtr0++] = (multY + multCbB) >> 8;
    outPtr0++;
    multY = (298 * bytesY[Y1Ptr++]);
    output[outPtr1++] = (multY + multCrR) >> 8;
    output[outPtr1++] = (multY - multCbCrG) >> 8;
    output[outPtr1++] = (multY + multCbB) >> 8;
    outPtr1++;
    multY = (298 * bytesY[Y1Ptr++]);
    output[outPtr1++] = (multY + multCrR) >> 8;
    output[outPtr1++] = (multY - multCbCrG) >> 8;
    output[outPtr1++] = (multY + multCbB) >> 8;
    outPtr1++;
   }
   outPtr0 += outStride;
   outPtr1 += outStride;
   ydec++;
  }
 } else {
  outPtr = 0;
  for (y = 0; y < height; y++) {
   xdec = 0;
   ydec = y >> vdec;
   YPtr = y * strideY;
   CbPtr = ydec * strideCb;
   CrPtr = ydec * strideCr;
   for (x = 0; x < width; x++) {
    xdec = x >> hdec;
    colorCb = bytesCb[CbPtr + xdec];
    colorCr = bytesCr[CrPtr + xdec];
    // Quickie YUV conversion
    // https://en.wikipedia.org/wiki/YCbCr#ITU-R_BT.2020_conversion
    // multiplied by 256 for integer-friendliness
    multCrR = (409 * colorCr) - 57088;
    multCbCrG = (100 * colorCb) + (208 * colorCr) - 34816;
    multCbB = (516 * colorCb) - 70912;
    multY = 298 * bytesY[YPtr++];
    output[outPtr++] = (multY + multCrR) >> 8;
    output[outPtr++] = (multY - multCbCrG) >> 8;
    output[outPtr++] = (multY + multCbB) >> 8;
    outPtr++;
   }
  }
 }
}
 function initImageData(width, height) {
  imageData = ctx.createImageData(width, height);
  // Prefill the alpha to opaque
  var data = imageData.data,
   pixelCount = width * height * 4;
  for (var i = 0; i < pixelCount; i += 4) {
   data[i + 3] = 255;
  }
 }
 function initResampleCanvas() {
  resampleCanvas = document.createElement('canvas');
  resampleCanvas.width = videoInfo.picWidth;
  resampleCanvas.height = videoInfo.picHeight;
  resampleContext = resampleCanvas.getContext('2d');
 }
 /**
	 * Actually draw a frame into the canvas.
	 */
 self.drawFrame = function drawFrame(yCbCrBuffer) {
  if (imageData === null ||
    imageData.width != yCbCrBuffer.width ||
    imageData.height != yCbCrBuffer.height) {
   initImageData(yCbCrBuffer.width, yCbCrBuffer.height);
  }
  convertYCbCr(yCbCrBuffer, imageData.data);
  var resample = (videoInfo.picWidth != videoInfo.displayWidth || videoInfo.picHeight != videoInfo.displayHeight);
  if (resample) {
   // hack for non-square aspect-ratio
   // putImageData doesn't resample, so we have to draw in two steps.
   if (!resampleCanvas) {
    initResampleCanvas();
   }
   drawContext = resampleContext;
  } else {
   drawContext = ctx;
  }
  drawContext.putImageData(imageData,
               0, 0,
               videoInfo.picX, videoInfo.picY,
               videoInfo.picWidth, videoInfo.picHeight);
  if (resample) {
   ctx.drawImage(resampleCanvas, 0, 0, videoInfo.displayWidth, videoInfo.displayHeight);
  }
 };
 return self;
}
