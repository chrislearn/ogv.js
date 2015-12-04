var AudioFeeder;

(function() {
	var global = this,
		AudioContext = global.AudioContext || global.webkitAudioContext;

	/**
	 * Object that we can throw audio data into and have it drain out.
	 *
	 * Because changing the number of channels on the fly is hard, hardcoding
	 * to 2 output channels. That's also all we can do on IE with Flash output.
	 *
	 * @param options: dictionary of config settings:
	 *                 'base' - Base URL to find additional resources in,
	 *                          such as the Flash audio output shim
	 */
	AudioFeeder = function(options) {
		var self = this;
		options = options || {};

		// Look for W3C Audio API
		if (!AudioContext) {
			// use Flash fallback
			var flashOptions = {};
			if (typeof options.base === 'string') {
				flashOptions.swf = options.base + '/dynamicaudio.swf?version=' + OGVVersion;
			}
			this.flashaudio = new DynamicAudio( flashOptions );
		}

		var bufferSize = this.bufferSize = 4096,
			channels = 0, // call init()!
			rate = 0; // call init()!

		// Always create stereo output. For iOS we have to set this stuff up
		// before we've actually gotten the info from the codec because we
		// must initialize from a UI event. Bah!
		var outputChannels = 2;

		function freshBuffer() {
			var buffer = [];
			for (var channel = 0; channel < outputChannels; channel++) {
				buffer[channel] = new Float32Array(bufferSize);
			}
			return buffer;
		}

		var buffers = [],
			context,
			node,
			pendingBuffer = freshBuffer(),
			pendingPos = 0,
			muted = false,
			queuedTime = 0,
			playbackTimeAtBufferTail = -1,
			targetRate,
			dropped = 0,
			delayedTime = 0;

		if(AudioContext) {
			if (typeof options.audioContext !== 'undefined') {
				// We were passed a pre-existing AudioContext object,
				// in the hopes this gets around iOS's weird activation rules.
				context = options.audioContext;
			} else {
				AudioFeeder.initSharedAudioContext();
				context = AudioFeeder.sharedAudioContext;
			}
			playbackTimeAtBufferTail = context.currentTime;

			if (context.createScriptProcessor) {
				node = context.createScriptProcessor(bufferSize, 0, outputChannels);
			} else if (context.createJavaScriptNode) {
				node = context.createJavaScriptNode(bufferSize, 0, outputChannels);
			} else {
				throw new Error("Bad version of web audio API?");
			}
			targetRate = this.targetRate = context.sampleRate;
		} else {
			targetRate = this.targetRate = 44100; // flash fallback
		}

		function popNextBuffer() {
			// hack hack
			// fixme: grab the right number of samples
			// and... rescale
			if (buffers && buffers.length > 0) {
				return buffers.shift();
			}
		}

		function audioProcess(event) {
			var channel, input, output, i, playbackTime;
			if (typeof event.playbackTime === 'number') {
				playbackTime = event.playbackTime;
			} else {
				// Safari 6.1 hack
				playbackTime = context.currentTime + (bufferSize / targetRate);
			}

			var expectedTime = playbackTimeAtBufferTail;
			if (expectedTime < playbackTime) {
                // we may have lost some time while something ran too slow
                delayedTime += (playbackTime - expectedTime);
			}

			var inputBuffer = popNextBuffer(bufferSize);
			if (!inputBuffer) {
				// We might be in a throttled background tab; go ping the decoder
				// and let it know we need more data now!
				if (self.onstarved) {
					self.onstarved();
					inputBuffer = popNextBuffer(bufferSize);
				}
			}

            // If we haven't got enough data, write a buffer of of silence to
            // both channels
			if (!inputBuffer) {
				for (channel = 0; channel < outputChannels; channel++) {
					output = event.outputBuffer.getChannelData(channel);
					for (i = 0; i < bufferSize; i++) {
						output[i] = 0;
					}
				}
				dropped++;
				return;
			}

			var volume = (muted ? 0 : 1);
			for (channel = 0; channel < outputChannels; channel++) {
				input = inputBuffer[channel];
				output = event.outputBuffer.getChannelData(channel);
				for (i = 0; i < Math.min(bufferSize, input.length); i++) {
					output[i] = input[i] * volume;
				}
			}
			queuedTime += (bufferSize / context.sampleRate);
			playbackTimeAtBufferTail = playbackTime + (bufferSize / context.sampleRate);
		}

		/**
		 * This is horribly naive and wrong.
		 * Replace me with a better algo!
		 */
		function resample(samples) {
			if (rate == targetRate && channels == outputChannels) {
				return samples;
			} else {
				var newSamples = [];
				for (var channel = 0; channel < outputChannels; channel++) {
					var inputChannel = channel;
					if (channel >= channels) {
						inputChannel = 0;
					}
					var input = samples[inputChannel],
						output = new Float32Array(Math.round(input.length * targetRate / rate));
					for (var i = 0; i < output.length; i++) {
						output[i] = input[(i * rate / targetRate) | 0];
					}
					newSamples.push(output);
				}
				return newSamples;
			}
		}

		/**
		 * Resampling, scaling and reordering for the Flash fallback.
		 * The Flash fallback expects 44.1 kHz, stereo
		 * Resampling: This is horribly naive and wrong.
		 * TODO: Replace me with a better algo!
		 */
		function resampleFlash(samples) {
			var sampleincr = rate / 44100;
			var samplecount = (samples[0].length * (44100 / rate)) | 0;
			var newSamples = new Int16Array(samplecount * 2);
			var chanLeft = samples[0];
			var chanRight = channels > 1 ? samples[1] : chanLeft;
			var multiplier = 16384; // smaller than 32768 to allow some headroom from those floats
			for(var s = 0; s < samplecount; s++) {
				var idx = (s * sampleincr) | 0;
				var idx_out = s * 2;
				// Use a smaller
				newSamples[idx_out] = chanLeft[idx] * multiplier;
				newSamples[idx_out + 1] = chanRight[idx] * multiplier;
			}
			return newSamples;
		}

		function resampleFlashMuted(samples) {
			// if muted: generate fitting number of samples for audio clock
			var samplecount = (samples[0].length * (44100 / rate)) | 0;
			return new Int16Array(samplecount * 2);
		}


		function pushSamples(samples) {
			var firstChannel = samples[0],
				sampleCount = firstChannel.length;
			for (var i = 0; i < sampleCount; i++) {
				for (var channel = 0; channel < outputChannels; channel++) {
					pendingBuffer[channel][pendingPos] = samples[channel][i];
				}
				if (++pendingPos == bufferSize) {
					buffers.push(pendingBuffer);
					pendingPos = 0;
					pendingBuffer = freshBuffer();
				}
			}
		}

		this.init = function(numChannels, sampleRate) {
			// warning: can't change channels here reliably
			rate = sampleRate;
			channels = numChannels;
			pendingBuffer = freshBuffer();
		};

		var hexDigits = ['0', '1', '2', '3', '4', '5', '6', '7',
						 '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
		var hexBytes = [];
		for (var i = 0; i < 256; i++) {
			hexBytes[i] = hexDigits[(i & 0x0f)] +
						  hexDigits[(i & 0xf0) >> 4];
		}
		function hexString(buffer) {
			var samples = new Uint8Array(buffer);
			var digits = "",
				len = samples.length;
			for (var i = 0; i < len; i++) {
				// Note that in IE 11 strong concatenation is twice as fast as
				// the traditional make-an-array-and-join here.
				digits += hexBytes[samples[i]];
			}
			return digits;
		}

		var flashBuffer = '',
			flushTimeout = null;
		function flushFlashBuffer() {
			var chunk = flashBuffer;
			if (self.flashaudio.flashElement.write) {
				self.flashaudio.flashElement.write(chunk);
			} else {
				self.waitUntilReady(function() {
					self.flashaudio.flashElement.write(chunk);
				});
			}
			flashBuffer = '';
			flushTimeout = null;
		}
		this.bufferData = function(samplesPerChannel) {
			if(this.flashaudio) {
				var resamples = !muted ? resampleFlash(samplesPerChannel) : resampleFlashMuted(samplesPerChannel);
				var flashElement = this.flashaudio.flashElement;
				if(resamples.length > 0) {
					var str = hexString(resamples.buffer);
					flashBuffer += str;
					if (!flushTimeout) {
						// consolidate multiple consecutive tiny buffers in one pass;
						// pushing data to Flash is relatively expensive on slow machines
						flushTimeout = setTimeout(flushFlashBuffer, 0);
					}
				}
			} else if (buffers) {
				var samples = resample(samplesPerChannel);
				pushSamples(samples);
			} else {
				console.log('no valid whatsit');
				self.close();
			}
		};

		function samplesQueued() {
			if (buffers) {
				var numSamplesQueued = 0;
				buffers.forEach(function(buffer) {
					numSamplesQueued += buffer[0].length;
				});

				var bufferedSamples = numSamplesQueued;
				var remainingSamples = Math.floor(Math.max(0, (playbackTimeAtBufferTail - context.currentTime)) * context.sampleRate);

				return bufferedSamples + remainingSamples;
			} else {
				return 0;
			}
		}

		var cachedFlashState = null,
			cachedFlashTime = 0,
			cachedFlashInterval = 40; // resync state no more often than every X ms

		/**
		 * @return {
		 *   playbackPosition: {number} seconds, with a system-provided base time
		 *   samplesQueued: {int}
		 *   dropped: {int}
		 * }
		 */
		this.getPlaybackState = function() {
			if (this.flashaudio) {
				var flashElement = this.flashaudio.flashElement;
				if (flashElement.write) {
					var now = Date.now(),
						delta = now - cachedFlashTime,
						state;
					if (cachedFlashState && delta < cachedFlashInterval) {
						state = {
							playbackPosition: cachedFlashState.playbackPosition + delta / 1000,
							samplesQueued: cachedFlashState.samplesQueued - delta * targetRate / 1000,
							dropped: cachedFlashState.dropped,
							delayed: cachedFlashState.delayed
						};
					} else {
						state = flashElement.getPlaybackState();
						cachedFlashState = state;
						cachedFlashTime = now;
					}
					state.samplesQueued += flashBuffer.length / 2;
					return state;
				} else {
					//console.log('getPlaybackState USED TOO EARLY');
					return {
						playbackPosition: 0,
						samplesQueued: 0,
						dropped: 0,
						delayed: 0
					};
				}
			} else {
				return {
					playbackPosition: queuedTime - Math.max(0, playbackTimeAtBufferTail - context.currentTime),
					samplesQueued: samplesQueued(),
					dropped: dropped,
					delayed: delayedTime
				};
			}
		};

		this.mute = function() {
			this.muted = muted = true;
		};

		this.unmute = function() {
			this.muted = muted = false;
		};

		this.close = function() {
			this.stop();

			if(this.flashaudio) {
				var wrapper = this.flashaudio.flashWrapper;
				wrapper.parentNode.removeChild(wrapper);
				this.flashaudio = null;
			}

			context = null;
			buffers = null;
		};

		this.waitUntilReady = function(callback) {
			var times = 0,
				maxTimes = 100;
			function pingFlashPlugin() {
				setTimeout(function doPingFlashPlugin() {
					times++;
					if (self.flashaudio && self.flashaudio.flashElement.write) {
						callback(this);
					} else if (times > maxTimes) {
						console.log("Failed to initialize Flash audio shim");
						self.close();
						callback(null);
					} else {
						pingFlashPlugin();
					}
				}, 20);
			}
			if (self.flashaudio) {
				pingFlashPlugin();
			} else {
				setTimeout(callback, 0);
			}
		};

		this.start = function() {
			if (this.flashaudio) {
				this.flashaudio.flashElement.start();
			} else {
				node.onaudioprocess = audioProcess;
				node.connect(context.destination);
				playbackTimeAtBufferTail = context.currentTime;
			}
		};

		this.stop = function() {
			if (this.flashaudio) {
				this.flashaudio.flashElement.stop();
			} else {
				if (node) {
					node.onaudioprocess = null;
					node.disconnect();
				}
			}
		};

		/**
		 * A callback when we find we're out of buffered data.
		 */
		this.onstarved = null;
	};

	AudioFeeder.sharedAudioContext = null;
	AudioFeeder.initSharedAudioContext = function() {
		if (AudioFeeder.sharedAudioContext === null) {
			if ( AudioContext ) {
				// We're only allowed 4 contexts on many browsers
				// and there's no way to discard them (!)...
				var context = AudioFeeder.sharedAudioContext = new AudioContext(),
					node;
				if ( context.createScriptProcessor ) {
					node = context.createScriptProcessor( 1024, 0, 2 );
				} else if ( context.createJavaScriptNode ) {
					node = context.createJavaScriptNode( 1024, 0, 2 );
				} else {
					throw new Error( "Bad version of web audio API?" );
				}

				// Don't actually run any audio, just start & stop the node
				node.connect( context.destination );
				node.disconnect();
			}
		}
	};


	/** Flash fallback **/

	/*
	The Flash fallback is based on https://github.com/an146/dynamicaudio.js

	This is the contents of the LICENSE file:

	Copyright (c) 2010, Ben Firshman
	All rights reserved.

	Redistribution and use in source and binary forms, with or without
	modification, are permitted provided that the following conditions are met:

	 * Redistributions of source code must retain the above copyright notice, this
	   list of conditions and the following disclaimer.
	 * Redistributions in binary form must reproduce the above copyright notice,
	   this list of conditions and the following disclaimer in the documentation
	   and/or other materials provided with the distribution.
	 * The names of its contributors may not be used to endorse or promote products
	   derived from this software without specific prior written permission.

	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
	ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
	WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
	DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
	ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
	(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
	LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
	ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
	(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
	SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	*/


	function DynamicAudio(args) {
		if (this instanceof arguments.callee) {
			if (typeof this.init === "function") {
				this.init.apply(this, (args && args.callee) ? args : arguments);
			}
		} else {
			return new arguments.callee(arguments);
		}
	}


	DynamicAudio.nextId = 1;

	DynamicAudio.prototype = {
		nextId: null,
		swf: 'dynamicaudio.swf?' + Math.random(),

		flashWrapper: null,
		flashElement: null,

		init: function(opts) {
			var self = this;
			self.id = DynamicAudio.nextId++;

			if (opts && typeof opts.swf !== 'undefined') {
				self.swf = opts.swf;
			}


			self.flashWrapper = document.createElement('div');
			self.flashWrapper.id = 'dynamicaudio-flashwrapper-'+self.id;
			// Credit to SoundManager2 for this:
			var s = self.flashWrapper.style;
			s.position = 'fixed';
			s.width = '11px'; // must be at least 6px for flash to run fast
			s.height = '11px';
			s.bottom = s.left = '0px';
			s.overflow = 'hidden';
			self.flashElement = document.createElement('div');
			self.flashElement.id = 'dynamicaudio-flashelement-'+self.id;
			self.flashWrapper.appendChild(self.flashElement);

			document.body.appendChild(self.flashWrapper);

			var id = self.flashElement.id;

			self.flashWrapper.innerHTML = "<object id='"+id+"' width='10' height='10' type='application/x-shockwave-flash' data='"+self.swf+"' style='visibility: visible;'><param name='allowscriptaccess' value='always'></object>";
			self.flashElement = document.getElementById(id);
		},
	};

})();
