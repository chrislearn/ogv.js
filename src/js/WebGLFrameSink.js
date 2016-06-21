var YCBCR_VERTEX_SHADER = require('./generated/YCbCr-vertex-shader.js');
var YCBCR_FRAGMENT_SHADER = require('./generated/YCbCr-fragment-shader.js');
var YCBCR_STRIPE_FRAGMENT_SHADER = require('./generated/YCbCr-stripe-fragment-shader.js');

/**
 * Warning: canvas must not have been used for 2d drawing prior!
 *
 * @param HTMLCanvasElement canvas
 * @constructor
 */
function WebGLFrameSink(canvas, videoInfo) {
	var self = this,
		gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
		debug = false; // swap this to enable more error checks, which can slow down rendering

	if (gl === null) {
		throw new Error('WebGL unavailable');
	}

	// GL!
	function checkError() {
		if (debug) {
			err = gl.getError();
			if (err !== 0) {
				throw new Error("GL error " + err);
			}
		}
	}

	function compileShader(type, source) {
		var shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);

		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			var err = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw new Error('GL shader compilation for ' + type + ' failed: ' + err);
		}

		return shader;
	}


	var vertexShader,
		fragmentShader,
		program,
		buffer,
		err;

	// In the world of GL there are no rectangles.
	// There are only triangles.
	// THERE IS NO SPOON.
	var rectangle = new Float32Array([
		// First triangle (top left, clockwise)
		-1.0, -1.0,
		+1.0, -1.0,
		-1.0, +1.0,

		// Second triangle (bottom right, clockwise)
		-1.0, +1.0,
		+1.0, -1.0,
		+1.0, +1.0
	]);

	var textures = {};
	function attachTexture(name, register, index, width, height, data) {
		var texture,
			texWidth = WebGLFrameSink.stripe ? (width / 4) : width,
			format = WebGLFrameSink.stripe ? gl.RGBA : gl.LUMINANCE,
			filter = WebGLFrameSink.stripe ? gl.NEAREST : gl.LINEAR;

		if (textures[name]) {
			// Reuse & update the existing texture
			texture = textures[name];
		} else {
			textures[name] = texture = gl.createTexture();
			checkError();

			gl.uniform1i(gl.getUniformLocation(program, name), index);
			checkError();
		}
		gl.activeTexture(register);
		checkError();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		checkError();
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		checkError();
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		checkError();
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		checkError();
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		checkError();

		gl.texImage2D(
			gl.TEXTURE_2D,
			0, // mip level
			format, // internal format
			texWidth,
			height,
			0, // border
			format, // format
			gl.UNSIGNED_BYTE, //type
			data // data!
		);
		checkError();

		return texture;
	}

	function buildStripe(width, height) {
		var len = width * height,
			out = new Uint32Array(len);
		for (var i = 0; i < len; i += 4) {
			out[i    ] = 0x000000ff;
			out[i + 1] = 0x0000ff00;
			out[i + 2] = 0x00ff0000;
			out[i + 3] = 0xff000000;
		}
		return new Uint8Array(out.buffer);
	}

	function init(yCbCrBuffer) {
		vertexShader = compileShader(gl.VERTEX_SHADER, YCBCR_VERTEX_SHADER);
		if (WebGLFrameSink.stripe) {
			fragmentShader = compileShader(gl.FRAGMENT_SHADER, YCBCR_STRIPE_FRAGMENT_SHADER);
		} else {
			fragmentShader = compileShader(gl.FRAGMENT_SHADER, YCBCR_FRAGMENT_SHADER);
		}

		program = gl.createProgram();
		gl.attachShader(program, vertexShader);
		checkError();

		gl.attachShader(program, fragmentShader);
		checkError();

		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			var err = gl.getProgramInfoLog(program);
			gl.deleteProgram(program);
			throw new Error('GL program linking failed: ' + err);
		}

		gl.useProgram(program);
		checkError();

		if (WebGLFrameSink.stripe) {
			attachTexture(
				'uStripeLuma',
				gl.TEXTURE3,
				3,
				yCbCrBuffer.strideY * 4,
				yCbCrBuffer.height,
				buildStripe(yCbCrBuffer.strideY, yCbCrBuffer.height)
			);
			checkError();

			attachTexture(
				'uStripeChroma',
				gl.TEXTURE4,
				4,
				yCbCrBuffer.strideCb * 4,
				yCbCrBuffer.height >> yCbCrBuffer.vdec,
				buildStripe(yCbCrBuffer.strideCb, yCbCrBuffer.height >> yCbCrBuffer.vdec)
			);
			checkError();
		}
	}

	self.drawFrame = function(yCbCrBuffer) {
		if (!program) {
			init(yCbCrBuffer);
		}

		// Set up the rectangle and draw it

		//
		// Set up geometry
		//

		buffer = gl.createBuffer();
		checkError();

		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		checkError();

		gl.bufferData(gl.ARRAY_BUFFER, rectangle, gl.STATIC_DRAW);
		checkError();

		var positionLocation = gl.getAttribLocation(program, 'aPosition');
		checkError();

		gl.enableVertexAttribArray(positionLocation);
		checkError();

		gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
		checkError();


		// Set up the texture geometry...
		function setupTexturePosition(varname, texWidth, texHeight) {
			// Warning: assumes that the stride for Cb and Cr is the same size in output pixels
			var textureX0 = videoInfo.picX / texWidth;
			var textureX1 = (videoInfo.picX + videoInfo.picWidth) / texWidth;
			var textureY0 = (videoInfo.picY + videoInfo.picHeight) / texHeight;
			var textureY1 = videoInfo.picY / texHeight;
			var textureRectangle = new Float32Array([
				textureX0, textureY0,
				textureX1, textureY0,
				textureX0, textureY1,
				textureX0, textureY1,
				textureX1, textureY0,
				textureX1, textureY1
			]);

			var texturePositionBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, texturePositionBuffer);
			checkError();

			gl.bufferData(gl.ARRAY_BUFFER, textureRectangle, gl.STATIC_DRAW);
			checkError();

			var texturePositionLocation = gl.getAttribLocation(program, varname);
			checkError();

			gl.enableVertexAttribArray(texturePositionLocation);
			checkError();

			gl.vertexAttribPointer(texturePositionLocation, 2, gl.FLOAT, false, 0, 0);
			checkError();
		}
		setupTexturePosition('aLumaPosition', yCbCrBuffer.strideY, yCbCrBuffer.height);
		setupTexturePosition('aChromaPosition', yCbCrBuffer.strideCb << yCbCrBuffer.hdec, yCbCrBuffer.height);

		// Create the textures...
		var textureY = attachTexture(
			'uTextureY',
			gl.TEXTURE0,
			0,
			yCbCrBuffer.strideY,
			yCbCrBuffer.height,
			yCbCrBuffer.bytesY
		);
		var textureCb = attachTexture(
			'uTextureCb',
			gl.TEXTURE1,
			1,
			yCbCrBuffer.strideCb,
			yCbCrBuffer.height >> yCbCrBuffer.vdec,
			yCbCrBuffer.bytesCb
		);
		var textureCr = attachTexture(
			'uTextureCr',
			gl.TEXTURE2,
			2,
			yCbCrBuffer.strideCr,
			yCbCrBuffer.height >> yCbCrBuffer.vdec,
			yCbCrBuffer.bytesCr
		);

		// Aaaaand draw stuff.
		gl.drawArrays(gl.TRIANGLES, 0, rectangle.length / 2);
		checkError();
	};
	
	self.clear = function() {
		gl.clearColor(0.0, 0.0, 0.0, 0.0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	};

	// @fixme make the clearing work reliably
	self.clear();
	gl.viewport(0, 0, canvas.width, canvas.height);
	self.clear();

	return self;
}

// For Windows; luminance and alpha textures are ssllooww to upload,
// so we pack into RGBA and unpack in the shaders.
//
// This seems to affect all browsers on Windows, probably due to fun
// mismatches between GL and D3D.
WebGLFrameSink.stripe = (function() {
	if (navigator.userAgent.indexOf('Windows') !== -1) {
		return true;
	}
	return false;
})();

/**
 * Static function to check if WebGL will be available with appropriate features.
 *
 * @return boolean
 */
WebGLFrameSink.isAvailable = function() {
	var canvas = document.createElement('canvas'),
		gl;
	canvas.width = 1;
	canvas.height = 1;
	var options = {
		// Still dithering on whether to use this.
		// Recommend avoiding it, as it's overly conservative
		//failIfMajorPerformanceCaveat: true
	};
	try {
		gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
	} catch (e) {
		return false;
	}
	if (gl) {
		var register = gl.TEXTURE0,
			width = 4,
			height = 4,
			texture = gl.createTexture(),
			data = new Uint8Array(width * height),
			texWidth = WebGLFrameSink.stripe ? (width / 4) : width,
			format = WebGLFrameSink.stripe ? gl.RGBA : gl.LUMINANCE,
			filter = WebGLFrameSink.stripe ? gl.NEAREST : gl.LINEAR;

		gl.activeTexture(register);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0, // mip level
			format, // internal format
			texWidth,
			height,
			0, // border
			format, // format
			gl.UNSIGNED_BYTE, //type
			data // data!
		);

		var err = gl.getError();
		if (err) {
			// Doesn't support luminance textures?
			return false;
		} else {
			return true;
		}
	} else {
		return false;
	}
};

module.exports = WebGLFrameSink;
