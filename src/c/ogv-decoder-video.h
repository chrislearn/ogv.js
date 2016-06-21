// Callbacks
extern void ogvjs_callback_init_video(int frameWidth, int frameHeight,
                                      int hdec, int vdec,
                                      double fps,
                                      int picWidth, int picHeight,
                                      int picX, int picY,
                                      int displayWidth, int displayHeight);

extern void ogvjs_callback_frame(unsigned char *bufferY, int strideY,
                                 unsigned char *bufferCb, int strideCb,
                                 unsigned char *bufferCr, int strideCr,
                                 int width, int height,
                                 int hdec, int vdec);
