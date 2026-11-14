import T from '@kmamal/testing'
import Fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Image, HTMLImageElement, ImageBitmap, createImageBitmap, decodeImage } from '../src/index.js'
import { fixture, QUADRANTS, pixelAt, near, rotatedJpeg, translucentPng, cmykJpeg, displayP3Png } from './helpers/common.mjs'

const loaded = (image) => new Promise((resolve, reject) => {
	image.onload = resolve
	image.onerror = (event) => reject(event.error)
})

const checkQuadrants = (t, image, tolerance = 3) => {
	t.ok(near(pixelAt(image, 16, 16), QUADRANTS.topLeft, tolerance), { pixel: pixelAt(image, 16, 16) })
	t.ok(near(pixelAt(image, 112, 16), QUADRANTS.topRight, tolerance), { pixel: pixelAt(image, 112, 16) })
	t.ok(near(pixelAt(image, 16, 112), QUADRANTS.bottomLeft, tolerance), { pixel: pixelAt(image, 16, 112) })
	t.ok(near(pixelAt(image, 112, 112), QUADRANTS.bottomRight, tolerance), { pixel: pixelAt(image, 112, 112) })
}

for (const name of [ 'quadrants.png', 'quadrants.jpg', 'quadrants.webp' ]) {
	T.test(`loads ${name}`, async (t) => {
		t.timeout(5e3)
		const image = new Image()
		t.ok(image instanceof HTMLImageElement)
		image.src = fixture(name)
		t.equal(image.complete, false)
		await loaded(image)
		t.equal(image.complete, true)
		t.equal(image.width, 128)
		t.equal(image.height, 128)
		t.equal(image.naturalWidth, 128)
		t.equal(image.data.length, 128 * 128 * 4)
		checkQuadrants(t, image, name === 'quadrants.png' ? 0 : 8)
	})
}

T.test("file URLs, decode() and listeners", async (t) => {
	t.timeout(5e3)
	const image = new Image()
	let events = 0
	image.addEventListener('load', () => { events++ })
	image.src = pathToFileURL(fixture('quadrants.png')).href
	await image.decode()
	t.equal(events, 1)
	t.equal(image.currentSrc, image.src)
})

T.test("explicit size", async (t) => {
	t.timeout(5e3)
	const image = new Image(10, 20)
	image.src = fixture('quadrants.png')
	await loaded(image)
	t.equal(image.width, 10)
	t.equal(image.height, 20)
	t.equal(image.naturalWidth, 128)
})

T.test("errors", async (t) => {
	t.timeout(5e3)
	const missing = new Image()
	missing.src = fixture('missing.png')
	await t.throwsAsync(() => loaded(missing))
	await t.throwsAsync(() => missing.decode())

	const garbage = new Image(undefined, undefined, {
		fetch: () => Promise.resolve(new Response(Buffer.from('not an image'))),
	})
	garbage.src = 'whatever'
	await t.throwsAsync(() => loaded(garbage))
	t.equal(garbage.data, null)
	t.equal(garbage.complete, true)
})

T.test("custom fetch", async (t) => {
	t.timeout(5e3)
	const requested = []
	const image = new Image(undefined, undefined, {
		fetch: (url) => {
			requested.push(url)
			return Promise.resolve(new Response(Fs.readFileSync(fixture('quadrants.png'))))
		},
	})
	image.src = 'https://example.com/quadrants.png'
	await loaded(image)
	t.equal(requested, [ 'https://example.com/quadrants.png' ])
	t.equal(image.width, 128)
	t.throws(() => new Image(undefined, undefined, { fetch: 5 }))
})

T.test("a newer src wins", async (t) => {
	t.timeout(5e3)
	const image = new Image()
	image.src = fixture('quadrants.jpg')
	image.src = fixture('quadrants.png')
	await loaded(image)
	t.equal(image.src, fixture('quadrants.png'))
	checkQuadrants(t, image, 0)
})

T.test("a loaded image is kept while the next one loads", async (t) => {
	t.timeout(5e3)
	const image = new Image()
	const first = fixture('quadrants.png')
	image.src = first
	await loaded(image)
	const data = image.data

	image.src = fixture('quadrants.webp')
	t.equal(image.complete, false)
	t.equal(image.data, data)
	t.equal(image.naturalWidth, 128)
	t.equal(image.currentSrc, first)
	const bitmap = await createImageBitmap(image)
	checkQuadrants(t, bitmap, 0)
	await loaded(image)
	t.equal(image.currentSrc, fixture('quadrants.webp'))

	const missing = fixture('missing.png')
	image.src = missing
	await t.throwsAsync(() => loaded(image))
	t.equal(image.data, null)
	t.equal(image.naturalWidth, 0)
	t.equal(image.currentSrc, missing)

	image.src = ''
	t.equal(image.complete, true)
	t.equal(image.currentSrc, '')
	await t.throwsAsync(() => image.decode())
})

T.test("decode() rejects when src changes", async (t) => {
	t.timeout(5e3)
	const image = new Image()
	image.src = fixture('quadrants.png')
	const first = image.decode()
	image.src = fixture('quadrants.jpg')
	await t.throwsAsync(() => first)
	await image.decode()
	t.equal(image.naturalWidth, 128)
})

T.test("onload and onerror", async (t) => {
	t.timeout(5e3)
	const image = new Image()
	const calls = []
	image.addEventListener('load', () => calls.push('before'))
	image.onload = () => calls.push('first')
	image.addEventListener('load', () => calls.push('after'))
	image.onload = () => calls.push('handler')
	t.equal(typeof image.onload, 'function')
	image.src = fixture('quadrants.png')
	await image.decode()
	t.equal(calls, [ 'before', 'handler', 'after' ])

	image.onload = null
	t.equal(image.onload, null)
	image.src = fixture('quadrants.jpg')
	await image.decode()
	t.equal(calls, [ 'before', 'handler', 'after', 'before', 'after' ])
})

T.test("EXIF rotation and colour space", async (t) => {
	t.timeout(5e3)
	const rotated = await createImageBitmap(new Blob([ await rotatedJpeg() ]))
	t.equal(rotated.width, 128)
	checkQuadrants(t, rotated, 12)

	const cmyk = await createImageBitmap(new Blob([ await cmykJpeg() ]))
	const pixel = pixelAt(cmyk, 1, 1)
	t.ok(pixel[0] > 200 && pixel[1] < 60 && pixel[2] < 60 && pixel[3] === 255, { pixel })
})

T.test("createImageBitmap from a blob", async (t) => {
	t.timeout(5e3)
	const blob = new Blob([ Fs.readFileSync(fixture('quadrants.png')) ])
	const bitmap = await createImageBitmap(blob)
	t.ok(bitmap instanceof ImageBitmap)
	t.equal(Object.prototype.toString.call(bitmap), '[object ImageBitmap]')
	checkQuadrants(t, bitmap, 0)

	const flipped = await createImageBitmap(blob, { imageOrientation: 'flipY' })
	t.equal(pixelAt(flipped, 16, 16), QUADRANTS.bottomLeft)
	t.equal(pixelAt(flipped, 16, 112), QUADRANTS.topLeft)

	const cropped = await createImageBitmap(blob, 64, 0, 64, 64)
	t.equal(cropped.width, 64)
	t.equal(pixelAt(cropped, 10, 10), QUADRANTS.topRight)

	const croppedFlipped = await createImageBitmap(blob, 0, 0, 128, 64, { imageOrientation: 'flipY' })
	t.equal(croppedFlipped.height, 64)
	t.equal(pixelAt(croppedFlipped, 16, 0), QUADRANTS.topLeft)
	t.equal(pixelAt(croppedFlipped, 112, 63), QUADRANTS.topRight)

	bitmap.close()
	t.equal(bitmap.width, 0)
	t.equal(bitmap.data, null)
	await t.throwsAsync(() => createImageBitmap(new Blob([ 'nope' ])))
})

T.test("createImageBitmap premultiplies alpha", async (t) => {
	t.timeout(5e3)
	const blob = new Blob([ await translucentPng() ])
	const straight = await createImageBitmap(blob)
	t.equal(pixelAt(straight, 0, 0), [ 200, 100, 50, 128 ])
	const premultiplied = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' })
	t.equal(pixelAt(premultiplied, 0, 0), [ 100, 50, 25, 128 ])
	t.equal(straight.premultiplied, false)
	t.equal(premultiplied.premultiplied, true)
	const wrapped = new ImageBitmap({ width: 1, height: 1, data: new Uint8Array([ 100, 50, 25, 128 ]), premultiplied: true })
	t.ok(near(pixelAt(await createImageBitmap(wrapped, { premultiplyAlpha: 'none' }), 0, 0), [ 200, 100, 50, 128 ], 2))

	t.equal(pixelAt(await createImageBitmap(premultiplied), 0, 0), [ 100, 50, 25, 128 ])
	t.equal(pixelAt(await createImageBitmap(premultiplied, { premultiplyAlpha: 'premultiply' }), 0, 0), [ 100, 50, 25, 128 ])
	t.ok(near(pixelAt(await createImageBitmap(premultiplied, { premultiplyAlpha: 'none' }), 0, 0), [ 200, 100, 50, 128 ], 2))
	t.equal(pixelAt(await createImageBitmap(straight, { premultiplyAlpha: 'premultiply' }), 0, 0), [ 100, 50, 25, 128 ])
	t.ok(near(pixelAt(await createImageBitmap(premultiplied, { resizeWidth: 4 }), 0, 0), [ 100, 50, 25, 128 ], 1))

	const decoded = await decodeImage(await translucentPng(), { premultiply: true })
	t.equal(decoded.premultiplied, true)
	t.equal((await decodeImage(await translucentPng())).premultiplied, false)
	const fromPlain = await createImageBitmap(decoded, { premultiplyAlpha: 'none' })
	t.equal(fromPlain.premultiplied, false)
	t.ok(near(pixelAt(fromPlain, 0, 0), [ 200, 100, 50, 128 ], 2))
	t.equal((await createImageBitmap(decoded)).premultiplied, true)
})

T.test("createImageBitmap resizes", async (t) => {
	t.timeout(5e3)
	const blob = new Blob([ Fs.readFileSync(fixture('quadrants.png')) ])
	const both = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 16, resizeQuality: 'pixelated' })
	t.equal([ both.width, both.height, both.data.length ], [ 32, 16, 32 * 16 * 4 ])
	t.equal(pixelAt(both, 4, 4), QUADRANTS.topLeft)
	t.equal(pixelAt(both, 28, 12), QUADRANTS.bottomRight)

	const widthOnly = await createImageBitmap(blob, 64, 0, 64, 128, { resizeWidth: 10, imageOrientation: 'flipY' })
	t.equal([ widthOnly.width, widthOnly.height ], [ 10, 20 ])
	t.ok(near(pixelAt(widthOnly, 5, 2), QUADRANTS.bottomRight))
	t.ok(near(pixelAt(widthOnly, 5, 17), QUADRANTS.topRight))

	const heightOnly = await createImageBitmap(blob, { resizeHeight: 3 })
	t.equal([ heightOnly.width, heightOnly.height ], [ 3, 3 ])

	await t.throwsAsync(() => createImageBitmap(blob, { resizeWidth: 0 }))
	await t.throwsAsync(() => createImageBitmap(blob, { resizeWidth: -1 }))
})

T.test("colorSpaceConversion", async (t) => {
	t.timeout(5e3)
	const blob = new Blob([ await displayP3Png() ])
	const converted = pixelAt(await createImageBitmap(blob), 0, 0)
	const raw = pixelAt(await createImageBitmap(blob, { colorSpaceConversion: 'none' }), 0, 0)
	t.ok(near(converted, [ 200, 100, 50, 255 ], 2), { converted })
	t.ok(!near(raw, converted, 5), { converted, raw })
})

T.test("createImageBitmap from images and pixels", async (t) => {
	t.timeout(5e3)
	const image = new Image()
	image.src = fixture('quadrants.png')
	await t.throwsWithAsync(() => createImageBitmap(image), (error) => { t.equal(error.name, 'InvalidStateError') })
	await image.decode()
	const bitmap = await createImageBitmap(image)
	checkQuadrants(t, bitmap, 0)
	t.ok(bitmap.data !== image.data)

	const pixels = { width: 1, height: 2, data: new Uint8ClampedArray([ 1, 2, 3, 4, 5, 6, 7, 8 ]) }
	const fromPixels = await createImageBitmap(pixels, { imageOrientation: 'flipY' })
	t.equal(Array.from(fromPixels.data), [ 5, 6, 7, 8, 1, 2, 3, 4 ])

	await t.throwsAsync(() => createImageBitmap(new Image()))
	await t.throwsAsync(() => createImageBitmap(null))
})
