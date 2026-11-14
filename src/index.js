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
		return new Response(null, { status: error.code === 'ENOENT' ? 404 : 500, statusText: error.message })
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

const decodeImage = async (bytes, { flipY = false, premultiply = false } = {}) => {
	let pipeline = loadSharp()(bytes, { failOn: 'none' }).rotate()
	if (flipY) { pipeline = pipeline.flip() }

	const { data, info } = await pipeline
		.toColourspace('srgb')
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true })

	const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
	if (premultiply) { premultiplyPixels(pixels) }
	return { width: info.width, height: info.height, data: pixels }
}

const checkFetch = (fetch) => {
	if (fetch !== undefined && typeof fetch !== 'function') { throw new TypeError("fetch must be a function") }
	return fetch ?? defaultFetch
}

class ImageBitmap {
	get [Symbol.toStringTag] () { return 'ImageBitmap' }

	constructor ({ width, height, data }) {
		this.width = width
		this.height = height
		this.data = data
	}

	close () {
		this.data = null
		this.width = 0
		this.height = 0
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
		this._loadId = 0
		this._pending = null
		this.data = null
		this.complete = true
		this.crossOrigin = null
		this.alt = ''
		this.decoding = 'auto'
		this.loading = 'eager'
		this.onload = null
		this.onerror = null
	}

	get width () { return this._width ?? this._naturalWidth }
	set width (value) { this._width = Math.max(0, Math.trunc(Number(value)) || 0) }

	get height () { return this._height ?? this._naturalHeight }
	set height (value) { this._height = Math.max(0, Math.trunc(Number(value)) || 0) }

	get naturalWidth () { return this._naturalWidth }
	get naturalHeight () { return this._naturalHeight }

	get currentSrc () { return this.complete && this.data !== null ? this._src : '' }

	get src () { return this._src }
	set src (value) {
		this._src = String(value)
		this._load()
	}

	dispatchEvent (event) {
		const handler = this[`on${event.type}`]
		if (typeof handler === 'function') { handler.call(this, event) }
		return super.dispatchEvent(event)
	}

	decode () {
		if (this._pending) { return this._pending.promise }
		if (this.data !== null) { return Promise.resolve() }
		return Promise.reject(new DOMException("the image could not be decoded", 'EncodingError'))
	}

	_load () {
		const loadId = ++this._loadId
		const source = this._src
		this.complete = false
		this.data = null
		this._naturalWidth = 0
		this._naturalHeight = 0

		let resolve
		let reject
		const promise = new Promise((res, rej) => {
			resolve = res
			reject = rej
		})
		promise.catch(() => {})
		this._pending = { promise }

		const run = async () => {
			if (source === '') { throw new Error("the image has no source") }
			const response = await this._fetch(source)
			if (!response.ok) { throw new Error(`failed to load "${source}" (${response.status} ${response.statusText})`) }
			const bytes = Buffer.from(await response.arrayBuffer())
			return await decodeImage(bytes)
		}

		run().then(
			(decoded) => {
				if (loadId !== this._loadId) { return }
				this._naturalWidth = decoded.width
				this._naturalHeight = decoded.height
				this.data = decoded.data
				this.complete = true
				this._pending = null
				resolve()
				this.dispatchEvent(new Event('load'))
			},
			(error) => {
				if (loadId !== this._loadId) { return }
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

const flipRows = (image) => {
	const { width, height, data } = image
	const out = new Uint8Array(data.length)
	const rowLength = width * 4
	for (let row = 0; row < height; row++) {
		out.set(data.subarray(row * rowLength, (row + 1) * rowLength), (height - 1 - row) * rowLength)
	}
	return { width, height, data: out }
}

const toPixels = (source) => {
	const { width, height, data } = source
	return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

const createImageBitmap = async (source, ...args) => {
	let options
	let rect = null
	if (args.length >= 4) {
		rect = args.slice(0, 4).map((x) => Math.trunc(Number(x)))
		options = args[4] ?? {}
		if (rect[2] === 0 || rect[3] === 0) { throw new RangeError("the crop rectangle must not be empty") }
	}
	else {
		options = args[0] ?? {}
	}
	const flipY = options.imageOrientation === 'flipY'
	const premultiply = options.premultiplyAlpha === 'premultiply'

	if (source === null || typeof source !== 'object') {
		throw new TypeError("source is not a valid image source")
	}

	let image
	if (typeof Blob !== 'undefined' && source instanceof Blob) {
		const bytes = Buffer.from(await source.arrayBuffer())
		try {
			image = await decodeImage(bytes, { flipY: flipY && rect === null, premultiply })
		}
		catch (error) {
			throw new DOMException(error.message, 'InvalidStateError')
		}
		if (rect === null) { return new ImageBitmap(image) }
		if (flipY) { image = flipRows(image) }
		image = crop(image, ...rect)
		if (flipY) { image = flipRows(image) }
		return new ImageBitmap(image)
	}

	if (source instanceof HTMLImageElement) {
		if (source.data === null) {
			if (source._pending) { await source._pending.promise }
			else { throw new DOMException("the image is not loaded", 'InvalidStateError') }
		}
	}
	if (source.data === null || source.data === undefined || typeof source.width !== 'number' || typeof source.height !== 'number') {
		throw new DOMException("source has no pixels", 'InvalidStateError')
	}

	image = toPixels(source instanceof HTMLImageElement ? { width: source.naturalWidth, height: source.naturalHeight, data: source.data } : source)
	image = rect === null ? { ...image, data: image.data.slice() } : crop(image, ...rect)
	if (flipY) { image = flipRows(image) }
	if (premultiply && !(source instanceof ImageBitmap)) { premultiplyPixels(image.data) }
	return new ImageBitmap(image)
}

module.exports = {
	HTMLImageElement,
	Image,
	ImageBitmap,
	createImageBitmap,
	decodeImage,
}
