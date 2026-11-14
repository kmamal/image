# @kmamal/image

`HTMLImageElement`, `ImageBitmap` and `createImageBitmap` for Node.js.
Uses [`sharp`](https://sharp.pixelplumbing.com/) for decoding.

```js
const { Image, createImageBitmap } = require('@kmamal/image')

const image = new Image()
image.src = 'texture.png'
await image.decode()
console.log(image.naturalWidth, image.naturalHeight, image.data.length)

const bitmap = await createImageBitmap(image, { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' })
```

Images decode to 8-bit RGBA in sRGB, with the EXIF orientation applied.
Both `Image` and `ImageBitmap` expose the pixels as `{ width, height, data }`, so that [`@kmamal/gl`](https://github.com/kmamal/headless-gl) and [`@kmamal/gpu`](https://github.com/kmamal/gpu) can work with them.
[`@kmamal/three`](https://github.com/kmamal/three.js) uses this package for its textures.

## Installation

```sh
npm install @kmamal/image
```

It is pure JS, and its only dependency is `sharp`, which comes with prebuilt binaries.
`sharp` is loaded the first time an image is decoded, so requiring this package is cheap.
TypeScript declarations are included.

## Pixels

Every decoded image is a plain object of the following shape, and so are `Image`, `ImageBitmap` and the result of `decodeImage`:

- `width` and `height` are the size in pixels.
- `data` is a `Uint8Array` of `width * height * 4` bytes: rows from top to bottom, pixels from left to right, and `R, G, B, A` for each pixel.

The colours are sRGB and the alpha is straight (not premultiplied) unless premultiplication was asked for.
CMYK, greyscale, palette and 16-bit images are all converted to this format, and images without alpha get an alpha of 255.

## Loading

Setting `src` starts a load, and the load goes through the element's fetch function.
The element calls it with the `src` string and nothing else, and expects a promise for a [`Response`](https://developer.mozilla.org/docs/Web/API/Response).
An `ok` response has its whole body read with `arrayBuffer()` and decoded; any other status is a load error.

### The default fetch

Without a `fetch` option, the element picks a loader from the `src`:

| `src` | Loaded with |
| --- | --- |
| `http:` and `https:` URLs | the global `fetch` |
| `data:` URLs | the global `fetch` |
| `blob:` URLs from `URL.createObjectURL()` | the global `fetch` |
| `file:` URLs | `fs.readFile` of the URL's path |
| anything else | `fs.readFile` of the path |

The URL schemes are matched case-insensitively.
A path is resolved against `process.cwd()`, not against the location of the calling module.
Percent-escapes in a path are decoded first (`my%20image.png` reads `my image.png`), and a path that is not valid percent-encoding is used as it is.
`?` and `#` in a path are part of the file name, because a path is not a URL.
A file that does not exist becomes a 404 response and any other read error a 500 response, with the error message as the `statusText`, so both reach the element as load errors.

The global `fetch` is looked up on every load, so a replacement installed after the element was created is still used for remote URLs.
It is called without options, so there are no request headers, credentials or `AbortSignal`, and a request that has started is never cancelled: a new `src` only makes the element ignore the old result.

### A custom fetch

The `fetch` option replaces the whole default, for local paths as well as URLs:

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

It receives `src` exactly as it was set, without resolving it against anything, and can return any object with `ok`, `status`, `statusText` and `arrayBuffer()`, not only a real `Response`.
If it throws or rejects, the load fails with that error.
The constructor throws a `TypeError` if `fetch` is not a function.
Each element has its own fetch function, so a subclass can set it for every element it creates:

```js
class AppImage extends Image {
	constructor (width, height) { super(width, height, { fetch: appFetch }) }
}
```

## API

### `new Image(width?, height?, options?)`

`HTMLImageElement` is the same class; `Image` extends it, as in browsers, and `instanceof HTMLImageElement` is true for both.
`options.fetch` is described under [Loading](#loading).

Properties:

- `src`: setting it, even to the same value, starts a new load, and the result of the previous one is ignored.
  The previous image's pixels are dropped at once, so `data` is `null` and `naturalWidth` and `naturalHeight` are 0 until the new image has loaded.
  The empty string fails with an error.
- `currentSrc`: the `src` of the loaded image, or `''` while loading or after an error.
- `complete`: `false` while a load is in progress and `true` otherwise, whether it succeeded or failed.
- `naturalWidth`, `naturalHeight` and `data`: the decoded image, as described under [Pixels](#pixels).
- `width` and `height`: the size given to the constructor or set later, truncated to an integer and clamped to 0 or more, or the natural size when none was given.
  They are only stored: the pixels always have the natural size.
- `alt`, `crossOrigin`, `decoding` and `loading`: stored but without any effect.

Events:

- `load` fires when the image has been decoded.
- `error` fires when fetching or decoding fails.
  Unlike in browsers, the event carries the cause as `event.error` and its text as `event.message`.
- Both can be listened to with `addEventListener` or with the `onload` and `onerror` properties, and only the latest load fires them.

Methods:

- `decode()` returns a promise that resolves when the current load succeeds and rejects with an `EncodingError` `DOMException` when it fails.
  For an image that has already loaded it resolves at once, and for an image without pixels, such as one that failed or never had a `src`, it rejects at once.

### `createImageBitmap(source, options?)`<br>`createImageBitmap(source, sx, sy, sw, sh, options?)`

Returns a promise for an `ImageBitmap` with a copy of the pixels, so the source can change or be closed afterwards.

`source` is one of:

- an `Image`: waits for a load that is in progress and rejects with its error if it fails, and rejects with an `InvalidStateError` `DOMException` if the image has no pixels and is not loading.
- a `Blob`: decoded like a fetched image, and rejects with an `InvalidStateError` if it is not a supported image.
- an `ImageBitmap`, or any `{ width, height, data }` object whose `data` is a `Uint8Array`, `Uint8ClampedArray` or other view of RGBA bytes.

The crop rectangle `sx`, `sy`, `sw`, `sh` is in source pixels, and a negative `sw` or `sh` extends it to the left or up from `sx` or `sy`.
Parts of the rectangle outside the source are transparent black.
An empty rectangle rejects with a `RangeError`.

Options:

- `imageOrientation: 'flipY'` turns the result upside down, after cropping.
  `'from-image'` and `'none'` keep the rows in order, and the EXIF orientation is always applied when decoding.
- `premultiplyAlpha: 'premultiply'` multiplies the colours by the alpha.
  An `ImageBitmap` source is assumed to have been premultiplied already if needed, and is not premultiplied again.
  `'default'` and `'none'` keep the alpha straight.

### `ImageBitmap`

`width`, `height` and `data` are the pixels, as described under [Pixels](#pixels).
`close()` releases the pixels and sets the size to 0.
`new ImageBitmap({ width, height, data })` wraps existing pixels without copying them.

### `decodeImage(bytes, options?)`

Decodes an encoded image held in a `Buffer` or `Uint8Array` and returns a promise for its [pixels](#pixels).
`options.flipY` turns the result upside down and `options.premultiply` premultiplies the alpha.
It rejects with `sharp`'s error if the bytes are not a supported image.
It is what `Image` and `createImageBitmap` use, for code that has the bytes already and needs no element.

## Formats

Supported formats are the ones that `sharp` reads: JPEG, PNG, WebP, AVIF, GIF, TIFF and SVG.
Animated GIF and WebP images decode to their first frame.
Truncated and slightly corrupt files decode as far as possible instead of failing.

## Differences from browsers

- There is no DOM, so an `Image` is not part of a document, and `alt`, `loading`, `decoding` and `crossOrigin` are stored but have no effect.
- `src` is not resolved against a base URL, and relative paths are relative to the working directory.
- Every image is converted to sRGB; the `colorSpaceConversion` and `resize*` options of `createImageBitmap` are not supported.
- `createImageBitmap` does not accept canvases, videos, `ImageData` or `OffscreenCanvas`, except as plain `{ width, height, data }` objects.
- Images expose their pixels as `data`, which browsers do not.
