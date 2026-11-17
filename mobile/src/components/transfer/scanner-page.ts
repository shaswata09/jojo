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
 * React Native — where `lib/pairing-qr.ts` reads the QR code in them with an
 * ordinary imported library. Putting the decoder in here would mean bundling
 * it into a string and maintaining a second build path for it.
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
 * Because the alternative is sending a megapixel over a bridge several times a
 * second. The pairing code is a version-5 QR code, 37 modules across (45 with
 * its quiet zone), and the decoder wants three or four pixels a module.
 *
 * ## Near and far, alternately
 *
 * Shrinking the whole view to `SIDE` gives a code four pixels a module only
 * once it fills about half the view — the phone held close. Held at a normal
 * distance from a laptop the code fills a quarter of it, which shrinks to under
 * two pixels a module and never reads. So the frames alternate: the whole view,
 * for a code held close, and the middle half of it at about the camera's own
 * resolution, for one held further off and aimed at. Measured with
 * `lib/pairing-qr.test.ts`: a code spanning 40% of `SIDE` reads with a little
 * blur; the zoomed frame puts a code that spans a quarter of the view there.
 */

/** Edge of the grayscale buffer handed to React Native. */
export const SIDE = 320

/**
 * Frames a second, the two views together. The code on the computer is still,
 * so there is nothing to keep up with: this is how quickly a phone that has
 * just been lined up notices. Six keeps the bridge to about 800 KB a second.
 */
export const SCAN_FPS = 6

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

      var zoomed = false;
      setInterval(function () {
        if (video.readyState < 2) return;
        // Square centre crop, so the code keeps its aspect and the reader is
        // not handed a stretched picture — the whole view, then the middle
        // half of it, in turn (see "Near and far" in scanner-page.ts).
        var w = video.videoWidth;
        var h = video.videoHeight;
        var side = Math.min(w, h) * (zoomed ? 0.5 : 1);
        zoomed = !zoomed;
        ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIDE, SIDE);

        var pixels = ctx.getImageData(0, 0, SIDE, SIDE).data;
        // Rec. 601 luma. The code is black on white, so any consistent grey
        // will do; the decoder thresholds against the picture's own levels.
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
