export type Fetch = (url: string) => Promise<Response>

export interface ImageOptions {
	fetch?: Fetch
}

export interface Pixels {
	readonly width: number
	readonly height: number
	readonly data: Uint8Array | Uint8ClampedArray
	readonly premultiplied?: boolean
}

export class HTMLImageElement extends EventTarget {
	constructor (width?: number, height?: number, options?: ImageOptions)
	src: string
	readonly currentSrc: string
	width: number
	height: number
	readonly naturalWidth: number
	readonly naturalHeight: number
	readonly complete: boolean
	readonly data: Uint8Array | null
	crossOrigin: string | null
	alt: string
	decoding: string
	loading: string
	onload: ((event: Event) => void) | null
	onerror: ((event: Event & { error?: Error, message?: string }) => void) | null
	decode (): Promise<void>
}

export class Image extends HTMLImageElement {}

export class ImageBitmap {
	constructor (pixels: Pixels)
	readonly width: number
	readonly height: number
	readonly data: Uint8Array | null
	readonly premultiplied: boolean
	close (): void
}

export interface ImageBitmapOptions {
	imageOrientation?: 'from-image' | 'flipY' | 'none'
	premultiplyAlpha?: 'default' | 'premultiply' | 'none'
	colorSpaceConversion?: 'default' | 'none'
	resizeWidth?: number
	resizeHeight?: number
	resizeQuality?: 'pixelated' | 'low' | 'medium' | 'high'
}

export type ImageBitmapSource = Blob | HTMLImageElement | ImageBitmap | Pixels

export function createImageBitmap (source: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>
export function createImageBitmap (source: ImageBitmapSource, sx: number, sy: number, sw: number, sh: number, options?: ImageBitmapOptions): Promise<ImageBitmap>

export function decodeImage (bytes: Uint8Array, options?: { flipY?: boolean, premultiply?: boolean }): Promise<Pixels>
