export class CanvasEncoder {
  constructor(options?: any) {}
  start() {}
  addFrame(canvas: any) {}
  finish(): Promise<Blob> {
    return Promise.resolve(new Blob([], { type: 'video/mp4' }))
  }
}
export class VideoEncoder {
  constructor(options?: any) {}
}
export class AudioEncoder {
  constructor(options?: any) {}
}

export class Mp4OutputFormat {
  constructor(options?: any) {}
  getSupportedVideoCodecs() { return ['avc1'] }
  getSupportedAudioCodecs() { return ['aac'] }
}
export class WebMOutputFormat {
  constructor(options?: any) {}
  getSupportedVideoCodecs() { return ['vp9'] }
  getSupportedAudioCodecs() { return ['opus'] }
}

export const getFirstEncodableVideoCodec = (formats: any[], codecs?: any) => 'avc1'
export const getFirstEncodableAudioCodec = (formats: any[], codecs?: any) => 'aac'

export class Output {
  target = { buffer: new ArrayBuffer(0) }
  constructor(options?: any) {}
  addTrack(track: any) {}
  addVideoTrack(source: any, options?: any) {}
  addAudioTrack(source: any, options?: any) {}
  start() {}
  cancel() {}
  finalize() {}
  finish(): Promise<Blob> {
    return Promise.resolve(new Blob([], { type: 'video/mp4' }))
  }
}

export class BufferTarget {
  buffer: ArrayBuffer = new ArrayBuffer(0)
}
export class CanvasSource {
  constructor(canvas: any, options?: any) {}
  addFrame(time: number) {}
  add(timestamp: number, duration?: number) {}
}
export class AudioBufferSource {
  constructor(buffer?: any, options?: any) {}
  add(timestamp?: any, duration?: any) {}
}

export const QUALITY_MEDIUM = 'medium'
export const QUALITY_HIGH = 'high'
export const QUALITY_VERY_HIGH = 'very_high'
