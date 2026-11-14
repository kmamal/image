import T from '@kmamal/testing'
import Fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Image, HTMLImageElement, ImageBitmap, createImageBitmap } from '../src/index.js'
import { fixture, QUADRANTS, pixelAt, near, rotatedJpeg, translucentPng, cmykJpeg } from './helpers/common.mjs'

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
})

T.test("createImageBitmap from images and pixels", async (t) => {
	t.timeout(5e3)
	const image = new Image()
	image.src = fixture('quadrants.png')
	const bitmap = await createImageBitmap(image)
	checkQuadrants(t, bitmap, 0)
	t.ok(bitmap.data !== image.data)

	const pixels = { width: 1, height: 2, data: new Uint8ClampedArray([ 1, 2, 3, 4, 5, 6, 7, 8 ]) }
	const fromPixels = await createImageBitmap(pixels, { imageOrientation: 'flipY' })
	t.equal(Array.from(fromPixels.data), [ 5, 6, 7, 8, 1, 2, 3, 4 ])

	await t.throwsAsync(() => createImageBitmap(new Image()))
	await t.throwsAsync(() => createImageBitmap(null))
})
