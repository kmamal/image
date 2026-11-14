# @kmamal/image

`HTMLImageElement`, `ImageBitmap` and `createImageBitmap` for Node.js.
Uses [`sharp`](https://github.com/lovell/sharp) for decoding.

```js
const { Image, createImageBitmap } = require('@kmamal/image')

const image = new Image()
image.src = 'texture.png'
await image.decode()
console.log(image.naturalWidth, image.naturalHeight, image.data.length)

const bitmap = await createImageBitmap(image, { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' })
```

## Formats

Supported formats are the ones that `sharp` reads: JPEG, PNG, WebP, AVIF, GIF, TIFF and SVG.
Animated GIF and WebP images decode to their first frame.

## Pixels

Every decoded image is a plain object of the following shape:

- `width` and `height` are the size in pixels.
- `data` is a `Uint8Array` of `width * height * 4` bytes: rows from top to bottom, pixels from left to right, and `R, G, B, A` for each pixel.
- `premultiplied` is `true` if the alpha in `data` is premultiplied.
  It is optional, and a missing or `false` value means straight alpha.

The colors are sRGB, unless `createImageBitmap` was asked not to convert them, and the alpha is straight unless premultiplication was asked for.
CMYK, greyscale, palette and 16-bit images are all converted to this format, and images without alpha get an alpha of 255.
EXIF orientation is applied.


## API

### `HTMLImageElement` and `Image`

Works like [`Image`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement) with the following exceptions:

- The constructor takes a third argument, `new Image(width?, height?, options?)`, whose `options.fetch` is described under [custom fetch](#custom-fetch).
- `src` keeps the value it was set to instead of resolving it against a base URL, and the default fetch resolves relative paths against the working directory.
- `data` holds the decoded pixels, as described under [Pixels](#pixels), or `null`.
- `alt`, `crossOrigin`, `decoding` and `loading` are stored but have no effect, and `srcset`, `sizes` and the other properties are missing.
- The `error` event carries the cause as `event.error` and its text as `event.message`.

### `createImageBitmap(source, options?)`<br>`createImageBitmap(source, sx, sy, sw, sh, options?)`

Works like [`createImageBitmap`](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap) with the following exceptions:

- `source` can be an `Image`, an `ImageBitmap`, a `Blob`, or any object with the shape described under [Pixels](#pixels), whose `data` can be any view of RGBA bytes.
  Canvases and videos are not supported, except as such objects.
- `colorSpaceConversion: 'none'` only has an effect on `Blob` sources, because an `Image` converts its pixels to sRGB when it loads.

### `ImageBitmap`

Works like [`ImageBitmap`](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap) with the following exceptions:

- `new ImageBitmap(pixels)` wraps existing [pixels](#pixels) without copying them.
- `data` and `premultiplied` are as described under [Pixels](#pixels), and `data` is `null` after `close()`.

### `decodeImage(bytes, options?)`

Decodes an encoded image held in a `Buffer` or `Uint8Array` and returns a promise for its [pixels](#pixels).
`options.flipY` turns the result upside down and `options.premultiply` premultiplies the alpha.
It rejects with `sharp`'s error if the bytes are not a supported image.
It is what `Image` and `createImageBitmap` use, for code that has the bytes already and needs no element.

## Custom fetch

Setting `src` starts a load, and the load goes through the element's fetch function.
By default `http:`, `https:`, `data:` and `blob:` URLs go through the global Node.js fetch, while `file:` URLs and paths are read from disk, with relative paths resolved against the working directory.
The `fetch` option replaces all of that with a function of your own:

```js
const image = new Image(undefined, undefined, {
	fetch: async (url) => {
		if (url.startsWith('assets/')) {
			return new Response(await Fs.promises.readFile(Path.join(assetDir, url.slice(7))))
		}
		return fetch(url, { headers: { authorization: token } })
	},
})
image.src = 'assets/texture.png'
```

The custom fetch function receives `src` exactly as it was set, without resolving it against anything, and must return an object that looks like a [`Response`](https://developer.mozilla.org/docs/Web/API/Response) i.e. it must implement `ok`, `status`, `statusText`, and `arrayBuffer()`.
If it throws or rejects, the load fails with that error.
