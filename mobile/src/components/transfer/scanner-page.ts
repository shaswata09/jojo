/**
 * The page the scanner WebView runs: a camera, and nothing else.
 *
 * React Native has no way to hand JavaScript a camera frame — `react-native-camera-kit`
 * returns a decoded barcode string and never a pixel, and the alternatives mean
 * a native module on two platforms. A WebView is a real browser engine, so it
 * has `getUserMedia` and a canvas, and it is already a dependency of this app.
 *
 * ## What this page does NOT do
 *
 * Decode. It grabs a frame, shrinks it, turns it grey, and posts the bytes to
 * React Native — where `core/pulse-read.ts` reads them, in TypeScript, in the
 * one copy the desktop browser also runs. Putting the decoder in here would
 * mean bundling it into a string and maintaining a second build path for it, so
 * that a phone and a laptop could disagree about what a frame says.
 *
 * ## The one prop that makes it work
 *
 * `baseUrl`. HTML loaded into a WebView with no base URL gets an `about:blank`
 * opaque origin, which is not a secure context, so `navigator.mediaDevices` is
 * `undefined` and there is no error explaining why. Asserting ANY https origin —
 * one that does not resolve and is never fetched — makes the document a secure
 * context and the camera opens. Verified on a real Android build; `PairingScanner`
 * passes it.
 *
 * ## Why it downsamples here
 *
 * Because the alternative is sending a megapixel over a bridge eight times a
 * second. The reader works from a small image anyway — it averages regions a
 * twelfth of the picture wide — so shrinking to `SIDE` before crossing costs
 * nothing and takes the payload to about nine kilobytes a frame.
 */

/** Edge of the grayscale buffer handed to React Native. */
export const SIDE = 128

/** Frames a second. Matched to what the pulse animation actually shows. */
export const SCAN_FPS = 8

/**
 * Why the camera did not start.
 *
 * Named rather than inlined so the advice table in `PairingScanner` is
 * exhaustive by construction — a new reason without a message becomes a type
 * error rather than an empty box on screen.
 */
export type ScannerErrorReason = 'denied' | 'unsupported' | 'failed'

/**
 * Messages the page posts. Discriminated, because a WebView can also emit
 * things this app did not write, and a silent mismatch would look like a camera
 * that sees nothing.
 */
export type ScannerMessage =
  | { kind: 'frame'; data: string }
  | { kind: 'error'; reason: ScannerErrorReason; detail: string }
  | { kind: 'ready' }

export const SCANNER_HTML = `<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" /></head>
<body style="margin:0;background:#000;overflow:hidden">
<video id="v" autoplay playsinline muted
       style="width:100vw;height:100vh;object-fit:cover;display:block"></video>
<script>
(function () {
  var SIDE = ${SIDE};
  var INTERVAL = ${Math.round(1000 / SCAN_FPS)};

  function post(message) {
    // The bridge takes strings only.
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    // Almost always the secure-context problem rather than a missing feature —
    // see the note about baseUrl in scanner-page.ts.
    post({ kind: 'error', reason: 'unsupported', detail: 'no camera API in this context' });
    return;
  }

  var video = document.getElementById('v');
  var canvas = document.createElement('canvas');
  canvas.width = SIDE;
  canvas.height = SIDE;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  navigator.mediaDevices
    .getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        // Asking for more than is needed costs battery and gives the sensor a
        // slower readout; the frame is shrunk to SIDE immediately anyway.
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })
    .then(function (stream) {
      video.srcObject = stream;
      post({ kind: 'ready' });

      setInterval(function () {
        if (video.readyState < 2) return;
        // Square centre crop, so the animation keeps its aspect and the reader
        // is not handed a stretched picture.
        var w = video.videoWidth;
        var h = video.videoHeight;
        var side = Math.min(w, h);
        ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIDE, SIDE);

        var pixels = ctx.getImageData(0, 0, SIDE, SIDE).data;
        // Rec. 601 luma. The pulse is red on a dark field, and weighting green
        // the way the eye does would throw away most of the signal — but the
        // reader thresholds against the picture's own levels, so a consistent
        // grey is all it needs.
        var out = new Uint8Array(SIDE * SIDE);
        for (var i = 0, p = 0; i < out.length; i++, p += 4) {
          out[i] = (pixels[p] * 77 + pixels[p + 1] * 150 + pixels[p + 2] * 29) >> 8;
        }

        // Base64 because the bridge is a string channel. Chunked, because
        // String.fromCharCode.apply on 16k arguments overflows the stack on
        // some engines.
        var binary = '';
        for (var j = 0; j < out.length; j += 4096) {
          binary += String.fromCharCode.apply(null, out.subarray(j, j + 4096));
        }
        post({ kind: 'frame', data: btoa(binary) });
      }, INTERVAL);
    })
    .catch(function (error) {
      var name = error && error.name ? error.name : '';
      post({
        kind: 'error',
        reason: name === 'NotAllowedError' ? 'denied' : 'failed',
        detail: String(name || error),
      });
    });
})();
</script>
</body>
</html>`
