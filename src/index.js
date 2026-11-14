const Fs = require('node:fs/promises')
const Path = require('node:path')
const { fileURLToPath } = require('node:url')

const REMOTE = /^(?:https?|data|blob):/iu

let sharp = null
const loadSharp = () => {
	sharp ??= require('sharp')
	return sharp
}

const defaultFetch = async (url) => {
	const location = String(url)
	if (REMOTE.test(location)) { return globalThis.fetch(location) }

	let filePath
	if (location.startsWith('file:')) { filePath = fileURLToPath(location) }
	else {
		let path = location
		try { path = decodeURIComponent(location) }
		catch {}
		filePath = Path.resolve(path)
	}

	try {
		return new Response(await Fs.readFile(filePath), { status: 200 })
	}
	catch (error) {
		return new Response(null, { status: error.code === 'ENOENT' ? 404 : 500, statusText: error.code ?? '' })
	}
}

const premultiplyPixels = (pixels) => {
	for (let i = 0; i < pixels.length; i += 4) {
		const alpha = pixels[i + 3]
		if (alpha === 255) { continue }
		pixels[i] = Math.round(pixels[i] * alpha / 255)
		pixels[i + 1] = Math.round(pixels[i + 1] * alpha / 255)
		pixels[i + 2] = Math.round(pixels[i + 2] * alpha / 255)
	}
}

const unpremultiplyPixels = (pixels) => {
	for (let i = 0; i < pixels.length; i += 4) {
		const alpha = pixels[i + 3]
		if (alpha === 255 || alpha === 0) { continue }
		pixels[i] = Math.min(255, Math.round(pixels[i] * 255 / alpha))
		pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * 255 / alpha))
		pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * 255 / alpha))
	}
}

const toView = (data) => new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

const decodePixels = async (bytes, { flipY = false, ignoreIcc = false } = {}) => {
	let pipeline = loadSharp()(bytes, { failOn: 'none', ignoreIcc }).rotate()
	if (flipY) { pipeline = pipeline.flip() }

	const { data, info } = await pipeline
		.toColourspace('srgb')
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true })

	return { width: info.width, height: info.height, data: toView(data) }
}

const decodeImage = async (bytes, { flipY = false, premultiply = false } = {}) => {
	const image = await decodePixels(bytes, { flipY })
	if (premultiply) { premultiplyPixels(image.data) }
	return { ...image, premultiplied: premultiply }
}

const checkFetch = (fetch) => {
	if (fetch !== undefined && typeof fetch !== 'function') { throw new TypeError("fetch must be a function") }
	return fetch ?? defaultFetch
}

class ImageBitmap {
	get [Symbol.toStringTag] () { return 'ImageBitmap' }

	constructor ({ width, height, data, premultiplied = false }) {
		this._width = width
		this._height = height
		this._data = data
		this._premultiplied = Boolean(premultiplied)
	}

	get width () { return this._width }
	get height () { return this._height }
	get data () { return this._data }
	get premultiplied () { return this._premultiplied }

	close () {
		this._data = null
		this._width = 0
		this._height = 0
	}
}

class HTMLImageElement extends EventTarget {
	get [Symbol.toStringTag] () { return 'HTMLImageElement' }

	constructor (width, height, options = {}) {
		super()
		this._fetch = checkFetch(options.fetch)
		this._width = width === undefined ? null : Math.max(0, Math.trunc(Number(width)) || 0)
		this._height = height === undefined ? null : Math.max(0, Math.trunc(Number(height)) || 0)
		this._naturalWidth = 0
		this._naturalHeight = 0
		this._src = ''
		this._currentSrc = ''
		this._loadId = 0
		this._pending = null
		this._handlers = {}
		this.data = null
		this.complete = true
		this.crossOrigin = null
		this.alt = ''
		this.decoding = 'auto'
		this.loading = 'eager'
	}

	get onload () { return this._handlers.load?.fn ?? null }
	set onload (value) { this._setHandler('load', value) }

	get onerror () { return this._handlers.error?.fn ?? null }
	set onerror (value) { this._setHandler('error', value) }

	_setHandler (type, value) {
		const fn = typeof value === 'function' ? value : null
		const entry = this._handlers[type]
		if (entry) {
			if (fn) {
				entry.fn = fn
				return
			}
			this.removeEventListener(type, entry.listener)
			delete this._handlers[type]
			return
		}
		if (!fn) { return }
		const created = { fn, listener: (event) => created.fn.call(this, event) }
		this._handlers[type] = created
		this.addEventListener(type, created.listener)
	}

	get width () { return this._width ?? this._naturalWidth }
	set width (value) { this._width = Math.max(0, Math.trunc(Number(value)) || 0) }

	get height () { return this._height ?? this._naturalHeight }
	set height (value) { this._height = Math.max(0, Math.trunc(Number(value)) || 0) }

	get naturalWidth () { return this._naturalWidth }
	get naturalHeight () { return this._naturalHeight }

	get currentSrc () { return this._currentSrc }

	get src () { return this._src }
	set src (value) {
		this._src = String(value)
		this._load()
	}

	decode () {
		if (this._pending) { return this._pending.promise }
		if (this.data !== null) { return Promise.resolve() }
		return Promise.reject(new DOMException("the image could not be decoded", 'EncodingError'))
	}

	_clear (source) {
		this.data = null
		this._naturalWidth = 0
		this._naturalHeight = 0
		this._currentSrc = source
	}

	_load () {
		const loadId = ++this._loadId
		const source = this._src
		this._pending?.reject(new DOMException("the image source changed", 'EncodingError'))
		if (source === '' || this.data === null) { this._clear(source) }
		this.complete = source === ''

		let resolve
		let reject
		const promise = new Promise((res, rej) => {
			resolve = res
			reject = rej
		})
		promise.catch(() => {})
		this._pending = { promise, reject }

		const run = async () => {
			if (source === '') { throw new Error("the image has no source") }
			const response = await this._fetch(source)
			if (!response.ok) { throw new Error(`failed to load "${source}" (${response.status} ${response.statusText})`) }
			const bytes = Buffer.from(await response.arrayBuffer())
			return await decodePixels(bytes)
		}

		run().then(
			(decoded) => {
				if (loadId !== this._loadId) { return }
				this._naturalWidth = decoded.width
				this._naturalHeight = decoded.height
				this.data = decoded.data
				this._currentSrc = source
				this.complete = true
				this._pending = null
				resolve()
				this.dispatchEvent(new Event('load'))
			},
			(error) => {
				if (loadId !== this._loadId) { return }
				this._clear(source)
				this.complete = true
				this._pending = null
				reject(new DOMException(error.message, 'EncodingError'))
				const event = new Event('error')
				event.error = error
				event.message = error.message
				this.dispatchEvent(event)
			},
		)
	}
}

class Image extends HTMLImageElement {}

const crop = (image, left, top, w, h) => {
	const sx = w < 0 ? left + w : left
	const sy = h < 0 ? top + h : top
	const sw = Math.abs(w)
	const sh = Math.abs(h)
	const data = new Uint8Array(sw * sh * 4)
	for (let row = 0; row < sh; row++) {
		const y = sy + row
		if (y < 0 || y >= image.height) { continue }
		for (let col = 0; col < sw; col++) {
			const x = sx + col
			if (x < 0 || x >= image.width) { continue }
			const s = (y * image.width + x) * 4
			data.set(image.data.subarray(s, s + 4), (row * sw + col) * 4)
		}
	}
	return { width: sw, height: sh, data }
}

const RESIZE_KERNELS = {
	pixelated: 'nearest',
	low: 'linear',
	medium: 'cubic',
	high: 'lanczos3',
}

const resize = async (image, premultiplied, width, height, quality) => {
	const { data, info } = await loadSharp()(image.data, {
		raw: { width: image.width, height: image.height, channels: 4, premultiplied },
	})
		.resize(width, height, { fit: 'fill', kernel: RESIZE_KERNELS[quality] ?? RESIZE_KERNELS.low })
		.raw()
		.toBuffer({ resolveWithObject: true })
	return { width: info.width, height: info.height, data: toView(data) }
}

const flipRows = (image) => {
	const { width, height, data } = image
	const out = new Uint8Array(data.length)
	const rowLength = width * 4
	for (let row = 0; row < height; row++) {
		out.set(data.subarray(row * rowLength, (row + 1) * rowLength), (height - 1 - row) * rowLength)
	}
	return { width, height, data: out }
}

const toDimension = (value, name) => {
	if (value === undefined) { return undefined }
	const number = Number(value)
	if (!Number.isFinite(number) || number < 0 || number > 0xFFFFFFFF) { throw new TypeError(`${name} is out of range`) }
	return Math.trunc(number)
}

const createImageBitmap = async (source, ...args) => {
	let options
	let rect = null
	if (args.length >= 4) {
		rect = args.slice(0, 4).map((x) => Math.trunc(Number(x)))
		options = args[4] ?? {}
	}
	else {
		options = args[0] ?? {}
	}
	const flipY = options.imageOrientation === 'flipY'
	const premultiplyAlpha = options.premultiplyAlpha ?? 'default'
	const ignoreIcc = options.colorSpaceConversion === 'none'
	const resizeWidth = toDimension(options.resizeWidth, 'resizeWidth')
	const resizeHeight = toDimension(options.resizeHeight, 'resizeHeight')
	const resizeQuality = options.resizeQuality ?? 'low'

	if (source === null || typeof source !== 'object') {
		throw new TypeError("source is not a valid image source")
	}
	if (rect !== null && (rect[2] === 0 || rect[3] === 0)) { throw new RangeError("the crop rectangle must not be empty") }
	if (resizeWidth === 0 || resizeHeight === 0) { throw new DOMException("the resize dimensions must not be 0", 'InvalidStateError') }

	let image
	let sourceData = null
	let sourcePremultiplied = false
	if (typeof Blob !== 'undefined' && source instanceof Blob) {
		const bytes = Buffer.from(await source.arrayBuffer())
		try {
			image = await decodePixels(bytes, { ignoreIcc })
		}
		catch (error) {
			throw new DOMException(error.message, 'InvalidStateError')
		}
	}
	else {
		if (source.data === null || source.data === undefined || typeof source.width !== 'number' || typeof source.height !== 'number') {
			throw new DOMException("source has no pixels", 'InvalidStateError')
		}
		image = source instanceof HTMLImageElement
			? { width: source.naturalWidth, height: source.naturalHeight, data: source.data }
			: { width: source.width, height: source.height, data: toView(source.data) }
		sourceData = image.data
		sourcePremultiplied = source.premultiplied === true
	}
	let premultiplied = sourcePremultiplied

	if (rect !== null) { image = crop(image, ...rect) }
	if (resizeWidth !== undefined || resizeHeight !== undefined) {
		const width = resizeWidth ?? Math.ceil(image.width * resizeHeight / image.height)
		const height = resizeHeight ?? Math.ceil(image.height * resizeWidth / image.width)
		image = await resize(image, premultiplied, width, height, resizeQuality)
		premultiplied = false
	}
	if (flipY) { image = flipRows(image) }
	if (image.data === sourceData) { image = { ...image, data: image.data.slice() } }
	const target = premultiplyAlpha === 'premultiply' || (premultiplyAlpha !== 'none' && sourcePremultiplied)
	if (target && !premultiplied) { premultiplyPixels(image.data) }
	else if (!target && premultiplied) { unpremultiplyPixels(image.data) }

	return new ImageBitmap({ ...image, premultiplied: target })
}

module.exports = {
	HTMLImageElement,
	Image,
	ImageBitmap,
	createImageBitmap,
	decodeImage,
}
