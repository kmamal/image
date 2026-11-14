import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const root = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), '../..')

export const fixture = (name) => Path.join(root, 'tests/fixtures', name)

export const QUADRANTS = {
	topLeft: [ 255, 0, 0, 255 ],
	topRight: [ 0, 255, 0, 255 ],
	bottomLeft: [ 0, 0, 255, 255 ],
	bottomRight: [ 128, 128, 128, 255 ],
}

export const pixelAt = (image, x, y) => {
	const i = (y * image.width + x) * 4
	return Array.from(image.data.slice(i, i + 4))
}

export const near = (a, b, tolerance = 3) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance)

export const rotatedJpeg = () => sharp(fixture('quadrants.png'))
	.rotate(-90)
	.jpeg({ quality: 100 })
	.withMetadata({ orientation: 6 })
	.toBuffer()

export const translucentPng = () => sharp({
	create: { width: 2, height: 2, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 128 / 255 } },
}).png().toBuffer()

export const cmykJpeg = () => sharp({
	create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
}).toColourspace('cmyk').jpeg().toBuffer()

export const displayP3Png = () => sharp({
	create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 100, b: 50 } },
}).withIccProfile('p3').png().toBuffer()
